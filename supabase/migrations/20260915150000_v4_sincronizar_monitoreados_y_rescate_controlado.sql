-- Los medios "monitoreados" viven en public.medios, pero el pool operativo
-- selecciona por public.medios_suscripcion -> medios_fuentes. Cuando se agregó
-- una nueva seccion/fuente de un dominio monitoreado, varias quedaron sin esa
-- suscripcion y se recolectaban sin poder llegar al clipping.
--
-- Sincronizamos solo filas que no existen. Una suscripcion bloqueada se respeta
-- siempre: bloquear una fuente debe seguir siendo una decision editorial.
with monitoreados as (
  select distinct
    m.client_id,
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm
  from public.medios m
  where m.activo
    and m.tipo = 'monitoreado'
), faltantes as (
  select mon.client_id, f.id as fuente_id
  from monitoreados mon
  join public.medios_fuentes f
    on f.dominio_norm = mon.dominio_norm
   and f.activa
  where not exists (
    select 1
    from public.medios_suscripcion s
    where s.client_id = mon.client_id
      and s.fuente_id = f.id
  )
)
insert into public.medios_suscripcion (
  client_id, fuente_id, tier, prioritario, origen, vigente_desde, updated_at
)
select client_id, fuente_id, null, true, 'manual_legacy', public.v4_hoy(), now()
from faltantes
on conflict (client_id, fuente_id) do nothing;

-- La correccion del 11/09 dejo el rescate de una fuente monitoreada solo para
-- BMS. Eso contradice la regla editorial compartida: una fuente monitoreada
-- debe poder ser evaluada aunque el titular no contenga una keyword exacta.
--
-- No salta la ventana, pais, desambiguacion ni reglas "no_entra_nunca": todas
-- esas compuertas ya ocurren dentro de v4_candidatas_aceptadas_rapido. Tampoco
-- la marca como forzada: A2 conserva la ultima palabra. El procesamiento sigue
-- paginado por la arquitectura anti-OOM existente.
do $rescate_monitoreados$
declare
  definicion text;
  anterior text := 'where ((select slug from cliente) = ''bms'' and a.fuente_monitoreada)';
  nuevo text := 'where a.fuente_monitoreada';
begin
  select pg_get_functiondef(
    'public.v4_candidatas_aceptadas_operativo(uuid,date,boolean)'::regprocedure
  ) into definicion;

  if position(anterior in definicion) = 0 then
    raise exception 'No coincide la version esperada del filtro operativo; se aborta para no abrir el rescate a ciegas.';
  end if;

  execute replace(definicion, anterior, nuevo);
end;
$rescate_monitoreados$;

comment on function public.v4_candidatas_aceptadas_operativo(uuid, date, boolean) is
  'Pool operativo: toda fuente monitoreada activa llega a A2 aun sin keyword literal; fecha, pais, ruido y desambiguacion se mantienen antes.';

-- Vista operativa: evita que una fuente monitoreada vuelva a quedar muda o sin
-- suscripcion sin que se vea. No guarda contenido ni modifica el pipeline.
create or replace view public.v4_salud_fuentes_monitoreadas as
with monitoreados as (
  select distinct c.id as client_id, c.slug as cliente, m.nombre as medio,
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm
  from public.medios m
  join public.clients c on c.id = m.client_id
  where m.activo and m.tipo = 'monitoreado'
)
select mon.cliente, mon.medio, mon.dominio_norm,
  f.id as fuente_id, f.seccion, f.activa as fuente_activa,
  s.id as suscripcion_id, s.bloqueado, s.tier, s.prioritario,
  ultimo.ts as ultimo_fetch_at, ultimo.diagnostico as ultimo_fetch_diagnostico,
  ultimo.http_status as ultimo_fetch_http, ultimo.articulos as ultimo_fetch_articulos,
  coalesce(raw.candidatas_48h, 0) as candidatas_48h,
  case
    when f.id is null then 'sin_fuente'
    when s.id is null then 'sin_suscripcion'
    when s.bloqueado then 'bloqueada_editorialmente'
    when ultimo.ts is null then 'sin_fetch_reciente'
    when ultimo.diagnostico not in ('ok', 'sitemap_index') or coalesce(ultimo.http_status, 0) >= 400 then 'fetch_con_problema'
    when coalesce(raw.candidatas_48h, 0) = 0 then 'sin_candidatas_48h'
    else 'ok'
  end as salud
from monitoreados mon
left join public.medios_fuentes f on f.dominio_norm = mon.dominio_norm and f.activa
left join public.medios_suscripcion s on s.client_id = mon.client_id and s.fuente_id = f.id
left join lateral (
  select l.ts, l.diagnostico, l.http_status, l.articulos
  from public.fetch_log l
  where l.fuente_id = f.id
  order by l.ts desc
  limit 1
) ultimo on true
left join lateral (
  select count(*)::int as candidatas_48h
  from public.candidatas_raw cr
  where cr.fuente_id = f.id
    and cr.capturado_at >= now() - interval '48 hours'
) raw on true;

grant select on public.v4_salud_fuentes_monitoreadas to anon, authenticated, service_role;
