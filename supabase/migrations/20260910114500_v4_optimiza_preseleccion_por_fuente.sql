-- La primera versión del filtro calculaba v4_keyword_norm contra todas las
-- notas suscriptas. Con cientos de miles de filas eso podía volver a tardar
-- más que el corte. Primero se arma el catálogo chico de fuentes del cliente;
-- el match de keywords solo se calcula para lo que no es monitoreado, no tiene
-- tier y no viene de Google Alerts.

create index if not exists candidatas_raw_fuente_fecha_idx
  on public.candidatas_raw (fuente_id, fecha);

create or replace function public.v4_candidatas_aceptadas_rapido(
  p_client_id uuid,
  p_fecha date default null
)
returns table (
  candidata_id uuid,
  es_prioritaria boolean,
  fecha_pub timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with param as (
  select coalesce(p_fecha, public.v4_hoy())::date as fecha
), reglas as materialized (
  select rf.*
  from public.reglas_filtro rf
  where rf.activa and (rf.client_id is null or rf.client_id = p_client_id)
), cfg as (
  select
    coalesce((select max(valor::int) from reglas where tipo = 'antiguedad'), 24) as ventana_h,
    coalesce((select max(valor::int) from reglas where tipo = 'titulo_corto'), 25) as titulo_min,
    public.v4_corte_cliente_art(p_client_id, (select fecha from param)) as corte
), monitoreadas as materialized (
  select distinct
    m.client_id,
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm
  from public.medios m
  where m.activo and m.tipo = 'monitoreado'
), fuentes_cliente as materialized (
  select f.id as fuente_id,
    max(s.tier) as fuente_tier,
    bool_or(mon.dominio_norm is not null) as fuente_monitoreada
  from public.medios_suscripcion s
  join public.medios_fuentes f on f.id = s.fuente_id and f.activa
  left join monitoreadas mon on mon.client_id = s.client_id and mon.dominio_norm = f.dominio_norm
  where s.client_id = p_client_id and coalesce(s.bloqueado, false) = false
  group by f.id
), suscritas as materialized (
  select c.*, fc.fuente_tier, fc.fuente_monitoreada,
    (coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) as txt,
    c.alerta_id is not null as viene_de_alerta
  from public.candidatas_raw c
  join fuentes_cliente fc on fc.fuente_id = c.fuente_id
  where c.fecha between (select fecha from param) - 1 and (select fecha from param)
    and (
      (c.fecha_confiable
        and c.fecha_pub >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg))
        and c.fecha_pub < (select corte from cfg))
      or
      ((not c.fecha_confiable or c.fecha_pub is null)
        and c.capturado_at >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg))
        and c.capturado_at < (select corte from cfg))
    )
), base as materialized (
  select s.*,
    exists (
      select 1 from reglas r
      where r.compuerta = 'entra_si_o_si' and r.tipo = 'patron_titulo'
        and s.txt ~* r.valor
    ) as marca,
    (s.fecha_confiable and s.fecha_pub < (select corte from cfg)
      - make_interval(hours => (select ventana_h from cfg))) as vieja,
    (s.fecha_confiable and s.fecha_pub >= (select corte from cfg)) as futura,
    (length(coalesce(s.titulo, '')) < (select titulo_min from cfg)
      and length(coalesce(s.snippet, '')) < 20) as titulo_pobre
  from suscritas s
), ancladas as (
  select b.*, true as tiene_ancla
  from base b
  where b.fuente_monitoreada or b.fuente_tier is not null or b.viene_de_alerta or b.marca
  union all
  select b.*,
    exists (
      select 1
      from public.kw_keywords k
      where k.client_id = p_client_id and k.activa
        and (' ' || public.v4_keyword_norm(b.txt) || ' ')
            like ('% ' || public.v4_keyword_norm(k.keyword) || ' %')
    ) as tiene_ancla
  from base b
  where not b.fuente_monitoreada and b.fuente_tier is null and not b.viene_de_alerta and not b.marca
), candidatas_a_regla as (
  select a.*
  from ancladas a
  where a.tiene_ancla
    and (a.marca or (not a.vieja and not a.futura and not a.titulo_pobre))
), filtradas as (
  select b.*,
    exists (
      select 1 from reglas r
      where r.compuerta = 'desambiguacion'
        and ((r.tipo = 'patron_titulo' and b.txt ~* r.valor)
          or (r.tipo = 'patron_url' and coalesce(b.url, '') ~* r.valor))
    ) as ambigua,
    exists (
      select 1 from reglas r
      where r.compuerta = 'no_entra_nunca'
        and (
          (r.tipo = 'patron_titulo' and b.txt ~* r.valor
            and not (r.valor ~ 'espa' and b.txt ~* 'argentin')
            and not (r.valor ~ 'volkswagen' and b.txt ~*
              '(enfermedad|vacuna|brote|sanidad|sanitari|zoonosis|parasit|garrapata|mastitis|bienestar animal)')
            and not (r.valor ~ 'senasa' and b.txt ~*
              '(aliment|nutricion|petfood|mascota|perro|gato|balanceado|golosina|chocolat|confiter|snack)'))
          or (r.tipo = 'patron_url' and coalesce(b.url, '') ~* r.valor)
          or (r.tipo = 'tld' and coalesce(b.dominio_norm, '') ~* r.valor)
          or (r.tipo = 'dominio' and coalesce(b.dominio_norm, '') ~* r.valor)
        )
    ) as tema_descartado
  from candidatas_a_regla b
), pasan_compuerta as (
  select f.*,
    (f.marca and not f.ambigua) as es_prioritaria
  from filtradas f
  where not f.ambigua and (f.marca or not f.tema_descartado)
), sin_repetida_del_dia as (
  select p.*,
    row_number() over (
      partition by p.dominio_norm,
        lower(regexp_replace(coalesce(p.titulo, ''), '[^a-zA-Z0-9]+', '', 'g'))
      order by (p.marca and not p.ambigua) desc, p.fecha_confiable desc,
        p.fecha_pub desc nulls last, p.capturado_at
    ) as rn
  from pasan_compuerta p
), aceptadas as (
  select p.*
  from sin_repetida_del_dia p
  left join public.notas_historico_url h
    on h.client_id = p_client_id
   and h.url_norm = p.url_canonica
   and h.primera_vez_fecha >= (select fecha from param) - 30
  where p.rn = 1 and h.id is null
)
select id, (es_prioritaria or fuente_monitoreada or fuente_tier is not null), fecha_pub
from aceptadas;
$function$;

comment on function public.v4_candidatas_aceptadas_rapido(uuid, date) is
  'Preseleccion optimizada: arma primero las fuentes del cliente y calcula keywords solo para adicionales sin tier.';

grant execute on function public.v4_candidatas_aceptadas_rapido(uuid, date)
  to anon, authenticated, service_role;
