-- fetch_log.pasada tenía el enum del diseño viejo del PRD: nocturna_1/2/3 · caliente ·
-- diurna · medicion. La decisión 7 del roadmap lo reemplazó por un barrido cada ~3 h
-- (08 · 11 · 14 · 17 · 20 · 23 · 02 · 05 + 06:30), así que el CHECK quedó desfasado y
-- rechazaba el identificador de barrido del recolector. Ninguna de esas etiquetas viejas
-- se usó nunca: las 2.839 filas existentes son todas 'medicion'.
--
-- Ahora es un patrón, no un enum: la pasada identifica UNA ventana concreta
-- (barrido_2026-09-04_14), que es lo que hace al recolector reentrante dentro de la
-- ventana y le permite volver a recorrer todo en la siguiente.

alter table public.fetch_log drop constraint fetch_log_pasada_check;

alter table public.fetch_log
  add constraint fetch_log_pasada_check check (
    pasada = 'medicion'
    or pasada ~ '^barrido_\d{4}-\d{2}-\d{2}_\d{2}$'
    or pasada ~ '^descubridor_\d{4}-\d{2}-\d{2}$'
  );

comment on column public.fetch_log.pasada is
  'Qué corrida trajo (o intentó traer) esta fuente. barrido_YYYY-MM-DD_HH = una ventana del recolector, en hora local ART. medicion = la corrida de cobertura one-shot. descubridor_YYYY-MM-DD = una corrida de A0.';

-- La vista de pendientes tiene que usar exactamente el mismo identificador.
create or replace view public.v4_recoleccion_pendientes as
select
  f.id            as fuente_id,
  f.dominio_norm,
  coalesce(e.url_recurso, f.url_feed) as url,
  e.formato,
  e.transporte,
  e.metodo_extraccion
from public.medios_fuentes f
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where f.activa is true
  and e.transporte is not null
  and e.metodo_extraccion = 'feed'
  and coalesce(e.url_recurso, f.url_feed) like 'http%'
  and not exists (
        select 1 from public.fetch_log l
        where l.fuente_id = f.id
          and l.fecha = current_date
          and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM-DD_HH24')
          and l.diagnostico = 'ok'
      )
order by f.dominio_norm;
