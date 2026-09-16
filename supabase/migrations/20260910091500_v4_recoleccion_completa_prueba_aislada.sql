-- Una corrida completa incluye medios monitoreados y adicionales de v3, pero
-- no debe cambiar la lista diaria (que sigue siendo sólo monitoreados + Alerts).
-- Estas vistas y esta pasada tienen identidad propia para que no compitan con el
-- barrido horario ni se confundan sus fetch_log.

alter table public.fetch_log drop constraint fetch_log_pasada_check;
alter table public.fetch_log add constraint fetch_log_pasada_check check (
  pasada = 'medicion'
  or pasada ~ '^barrido_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}$'
  or pasada ~ '^alertas_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}$'
  or pasada ~ '^descubridor_[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or pasada ~ '^prueba_completa_[0-9]{4}-[0-9]{2}-[0-9]{2}$'
);

create or replace view public.v4_fuentes_completa_prueba as
with fuentes_v3 as (
  select distinct lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm
  from public.medios m
  where m.activo and m.tipo in ('monitoreado', 'adicional')
)
select f.id as fuente_id, f.dominio_norm
from public.medios_fuentes f
join fuentes_v3 v3 on v3.dominio_norm = f.dominio_norm
where f.activa;

create or replace view public.v4_recoleccion_completa_prueba_pendientes as
select f.id as fuente_id,
       f.dominio_norm,
       coalesce(e.url_recurso, f.url_feed) as url,
       e.formato,
       e.transporte,
       e.metodo_extraccion
from public.medios_fuentes f
join public.v4_fuentes_completa_prueba p on p.fuente_id = f.id
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where e.metodo_extraccion = 'feed'
  and e.transporte is not null
  and coalesce(e.url_recurso, f.url_feed) like 'http%'
  and not exists (
    select 1 from public.fetch_log l
    where l.fuente_id = f.id
      and l.fecha = public.v4_hoy()
      and l.pasada = 'prueba_completa_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
  )
order by f.dominio_norm;

create or replace view public.v4_recoleccion_html_completa_prueba_pendientes as
select f.id as fuente_id,
       f.dominio_norm,
       coalesce(e.url_recurso, 'https://' || f.dominio_norm) as url,
       e.transporte
from public.medios_fuentes f
join public.v4_fuentes_completa_prueba p on p.fuente_id = f.id
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where e.metodo_extraccion = 'html'
  and e.transporte is not null
  and not exists (
    select 1 from public.fetch_log l
    where l.fuente_id = f.id
      and l.fecha = public.v4_hoy()
      and l.pasada = 'prueba_completa_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
  )
order by f.dominio_norm;

grant select on public.v4_fuentes_completa_prueba to anon, authenticated, service_role;
grant select on public.v4_recoleccion_completa_prueba_pendientes to anon, authenticated, service_role;
grant select on public.v4_recoleccion_html_completa_prueba_pendientes to anon, authenticated, service_role;
