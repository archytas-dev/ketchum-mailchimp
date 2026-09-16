-- Un medio monitoreado se visita siempre, pero no todo lo que publica entra al
-- clipping. El pool diario necesita además una señal de relevancia: keyword,
-- marca protegida o Google Alert. El tier decide prioridad de la fuente, no
-- convierte una nota ajena al cliente en noticia.

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
), keywords as materialized (
  select public.v4_keyword_norm(k.keyword) as keyword_norm
  from public.kw_keywords k
  where k.client_id = p_client_id and k.activa
    and nullif(public.v4_keyword_norm(k.keyword), '') is not null
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
  where s.client_id = p_client_id
    and coalesce(s.bloqueado, false) = false
    and (s.tier is not null or mon.dominio_norm is not null)
  group by f.id
), suscritas as materialized (
  select c.*, fc.fuente_tier, fc.fuente_monitoreada, false as viene_de_alerta,
    (coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) as txt
  from public.candidatas_raw c
  join fuentes_cliente fc on fc.fuente_id = c.fuente_id
  where c.alerta_id is null
    and c.fecha between (select fecha from param) - 1 and (select fecha from param)
    and (
      (c.fecha_confiable
        and c.fecha_pub >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg))
        and c.fecha_pub < (select corte from cfg))
      or
      ((not c.fecha_confiable or c.fecha_pub is null)
        and c.capturado_at >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg))
        and c.capturado_at < (select corte from cfg))
    )
  union all
  select c.*, null::int as fuente_tier, false as fuente_monitoreada, true as viene_de_alerta,
    (coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) as txt
  from public.candidatas_raw c
  join public.google_alerts ga on ga.id = c.alerta_id
    and ga.client_id = p_client_id and ga.activa
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
), textos as materialized (
  select b.*, public.v4_keyword_norm(b.txt) as txt_norm
  from base b
), con_relevancia as (
  select t.*,
    (t.marca or t.viene_de_alerta or exists (
      select 1 from keywords k
      where (' ' || t.txt_norm || ' ') like ('% ' || k.keyword_norm || ' %')
    )) as tiene_relevancia
  from textos t
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
  from con_relevancia b
), pasan_compuerta as (
  select f.*,
    (f.marca or f.viene_de_alerta) and not f.ambigua as es_prioritaria
  from filtradas f
  where f.tiene_relevancia
    and not f.ambigua
    and (f.marca or not f.tema_descartado)
    and (f.marca or f.viene_de_alerta or not f.vieja and not f.futura and not f.titulo_pobre)
), sin_repetida_del_dia as (
  select p.*,
    row_number() over (
      partition by p.dominio_norm,
        lower(regexp_replace(coalesce(p.titulo, ''), '[^a-zA-Z0-9]+', '', 'g'))
      order by p.es_prioritaria desc, p.fecha_confiable desc,
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
select id, es_prioritaria, fecha_pub
from aceptadas;
$function$;

comment on function public.v4_candidatas_aceptadas_rapido(uuid, date) is
  'Pool diario: fuentes monitoreadas/tier/Alerts y filtro duro de keyword, marca o alerta antes de A1/A2.';

grant execute on function public.v4_candidatas_aceptadas_rapido(uuid, date)
  to anon, authenticated, service_role;
