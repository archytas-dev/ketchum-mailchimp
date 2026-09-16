-- El armado solo necesita las candidatas que pasan las compuertas. El
-- evaluador completo conserva por que se descarto cada una (util para la
-- auditoria), pero calcular esas explicaciones para todo el sitemap diario
-- era el cuello de botella. Esta funcion conserva exactamente el conjunto que
-- pasa y evita evaluar reglas de tema sobre notas que ya son viejas o pobres.

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
  select coalesce(p_fecha, public.v4_hoy()) as fecha
), reglas as materialized (
  select rf.*
  from public.reglas_filtro rf
  where rf.activa and (rf.client_id is null or rf.client_id = p_client_id)
), cfg as (
  select
    coalesce((select max(valor::int) from reglas where tipo = 'antiguedad'), 24) as ventana_h,
    coalesce((select max(valor::int) from reglas where tipo = 'titulo_corto'), 25) as titulo_min,
    (((select fecha from param) + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as corte
), suscritas as materialized (
  select c.*,
    (coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) as txt
  from public.candidatas_raw c
  join public.medios_fuentes f on f.id = c.fuente_id and f.activa is true
  join public.medios_suscripcion m on m.fuente_id = f.id
    and m.client_id = p_client_id and coalesce(m.bloqueado, false) = false
  where c.fecha = (select fecha from param)
), base as (
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
), candidatas_a_regla as (
  -- Si una nota no menciona la marca y ya falla por fecha/titulo, ningun
  -- detalle de regla puede hacerla entrar. Se la saca antes de las regex caras.
  select b.*
  from base b
  where b.marca or (not b.vieja and not b.futura and not b.titulo_pobre)
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
select id, es_prioritaria, fecha_pub
from aceptadas;
$function$;

comment on function public.v4_candidatas_aceptadas_rapido(uuid, date) is
  'Preseleccion para A1/A2: mismo conjunto aceptado que v4_evaluar_candidatas, sin calcular motivos de descarte innecesarios.';

grant execute on function public.v4_candidatas_aceptadas_rapido(uuid, date)
  to anon, authenticated, service_role;
