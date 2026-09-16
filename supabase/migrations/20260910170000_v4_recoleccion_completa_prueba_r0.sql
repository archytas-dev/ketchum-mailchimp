-- Permite una segunda pasada completa de prueba el mismo dia sin reutilizar
-- ni borrar los intentos de la primera. Es solo para pruebas internas.
alter table public.fetch_log drop constraint if exists fetch_log_pasada_check;
alter table public.fetch_log add constraint fetch_log_pasada_check check (
  pasada = 'medicion'
  or pasada ~ '^barrido_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}$'
  or pasada ~ '^alertas_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}$'
  or pasada ~ '^descubridor_[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or pasada ~ '^prueba_completa_[0-9]{4}-[0-9]{2}-[0-9]{2}(_[a-z0-9_]+)?$'
);

create or replace view public.v4_recoleccion_completa_prueba_pendientes as
select f.id as fuente_id, f.dominio_norm,
       coalesce(nullif(f.url_feed, ''), e.url_recurso) as url,
       coalesce(f.formato, e.formato) as formato,
       coalesce(f.transporte, e.transporte) as transporte,
       coalesce(f.metodo_extraccion, e.metodo_extraccion) as metodo_extraccion
from public.medios_fuentes f
join public.v4_fuentes_completa_prueba p on p.fuente_id = f.id
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where coalesce(f.metodo_extraccion, e.metodo_extraccion) = 'feed'
  and coalesce(f.transporte, e.transporte) is not null
  and coalesce(nullif(f.url_feed, ''), e.url_recurso) like 'http%'
  and not exists (
    select 1 from public.fetch_log l
    where l.fuente_id = f.id and l.fecha = public.v4_hoy()
      and l.pasada = 'prueba_completa_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') || '_r0'
  )
order by f.dominio_norm, f.seccion;

create or replace view public.v4_recoleccion_html_completa_prueba_pendientes as
select f.id as fuente_id, f.dominio_norm,
       coalesce(nullif(f.url_feed, ''), e.url_recurso, 'https://' || f.dominio_norm) as url,
       coalesce(f.transporte, e.transporte) as transporte
from public.medios_fuentes f
join public.v4_fuentes_completa_prueba p on p.fuente_id = f.id
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where coalesce(f.metodo_extraccion, e.metodo_extraccion) = 'html'
  and coalesce(f.transporte, e.transporte) is not null
  and not exists (
    select 1 from public.fetch_log l
    where l.fuente_id = f.id and l.fecha = public.v4_hoy()
      and l.pasada = 'prueba_completa_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') || '_r0'
  )
order by f.dominio_norm, f.seccion;

grant select on public.v4_recoleccion_completa_prueba_pendientes,
                public.v4_recoleccion_html_completa_prueba_pendientes
to anon, authenticated, service_role;
