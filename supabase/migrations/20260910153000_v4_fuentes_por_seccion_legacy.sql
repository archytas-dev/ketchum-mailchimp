-- V4 había condensado cada medio en una sola fuente por dominio. Eso pierde
-- cobertura cuando v3 tenía feeds distintos por sección (por ejemplo Infobae
-- Salud/Economía/Mascotas o Clarín Política/Sociedad/Viajes). Una fuente pasa
-- a poder declarar cómo se extrae ella misma; la estrategia del dominio queda
-- como fallback para no modificar las fuentes ya operativas.

alter table public.medios_fuentes
  add column if not exists metodo_extraccion text,
  add column if not exists transporte text;

alter table public.medios_fuentes
  drop constraint if exists medios_fuentes_metodo_extraccion_check;
alter table public.medios_fuentes
  add constraint medios_fuentes_metodo_extraccion_check
  check (metodo_extraccion is null or metodo_extraccion in ('feed', 'html'));

alter table public.medios_fuentes
  drop constraint if exists medios_fuentes_transporte_check;
alter table public.medios_fuentes
  add constraint medios_fuentes_transporte_check
  check (transporte is null or transporte in ('directo', 'cloudflare', 'aws', 'jina', 'brightdata'));

comment on column public.medios_fuentes.metodo_extraccion is
  'Override por sección. NULL conserva el método de medios_estrategia del dominio.';
comment on column public.medios_fuentes.transporte is
  'Override por sección. NULL conserva el transporte de medios_estrategia del dominio.';

-- Cada endpoint distinto de v3 pasa a ser una fuente propia. Se preservan los
-- parámetros de query porque algunos feeds los necesitan; sólo se normalizan
-- esquema, www y slash final para no duplicar el mismo endpoint.
with legacy as (
  select
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm,
    btrim(m.url_feed) as url_feed,
    lower(regexp_replace(regexp_replace(btrim(m.url_feed), '^https?://(www[.])?', '', 'i'), '/+$', '')) as url_norm,
    lower(coalesce(m.metodo, '')) as metodo,
    m.tipo,
    m.nombre
  from public.medios m
  where m.activo
    and m.tipo in ('monitoreado', 'adicional')
    and nullif(btrim(m.url_feed), '') like 'http%'
    and lower(coalesce(m.metodo, '')) in ('rss', 'sitemap', 'wordpress', 'jina')
    and exists (select 1 from public.medios_catalogo c where c.dominio_norm =
      lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')))
), elegidas as (
  select distinct on (dominio_norm, url_norm)
    dominio_norm, url_feed, url_norm, metodo, tipo, nombre
  from legacy
  order by dominio_norm, url_norm,
    case when tipo = 'monitoreado' then 0 else 1 end,
    case when metodo in ('rss', 'sitemap', 'wordpress') then 0 else 1 end,
    url_feed
), faltantes as (
  select e.*
  from elegidas e
  where not exists (
    select 1
    from public.medios_fuentes f
    where f.dominio_norm = e.dominio_norm
      and lower(regexp_replace(regexp_replace(coalesce(f.url_feed, ''), '^https?://(www[.])?', '', 'i'), '/+$', '')) = e.url_norm
  )
)
insert into public.medios_fuentes (
  dominio_norm, seccion, formato, url_feed, metodo_extraccion, activa, updated_at
)
select
  dominio_norm,
  'v3/' || substring(md5(dominio_norm || '/' || url_norm) from 1 for 12),
  case metodo
    when 'rss' then 'rss'
    when 'sitemap' then 'sitemap'
    when 'wordpress' then 'wordpress'
    when 'jina' then 'html'
  end,
  url_feed,
  case when metodo = 'jina' then 'html' else 'feed' end,
  true,
  now()
from faltantes
on conflict (dominio_norm, lower(seccion)) do nothing;

-- Se suscribe cada sección sólo a los clientes que ya la tenían declarada en
-- v3. Un feed adicional de Booking no pasa a ser una fuente de BMS por el solo
-- hecho de compartir dominio. Los tiers se recuperan con el mismo cruce exacto
-- por nombre que usa la migración de tiers de v4.
with legacy as (
  select
    m.client_id,
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm,
    lower(regexp_replace(regexp_replace(btrim(m.url_feed), '^https?://(www[.])?', '', 'i'), '/+$', '')) as url_norm,
    lower(coalesce(m.metodo, '')) as metodo,
    m.tipo,
    m.nombre
  from public.medios m
  where m.activo
    and m.tipo in ('monitoreado', 'adicional')
    and nullif(btrim(m.url_feed), '') like 'http%'
    and lower(coalesce(m.metodo, '')) in ('rss', 'sitemap', 'wordpress', 'jina')
    and exists (select 1 from public.medios_catalogo c where c.dominio_norm =
      lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')))
), fuente_legacy as (
  select l.client_id, l.tipo, l.nombre, f.id as fuente_id
  from legacy l
  join public.medios_fuentes f
    on f.dominio_norm = l.dominio_norm
   and lower(regexp_replace(regexp_replace(coalesce(f.url_feed, ''), '^https?://(www[.])?', '', 'i'), '/+$', '')) = l.url_norm
   and f.seccion like 'v3/%'
), tiers_normalizados as (
  select client_id, public.tier_norm(dominio) as clave_tier, min(tier) as tier
  from public.tiers
  where tier is not null
  group by client_id, public.tier_norm(dominio)
), suscripciones as (
  select fl.client_id, fl.fuente_id,
    max(t.tier) as tier,
    bool_or(fl.tipo = 'monitoreado') as prioritario
  from fuente_legacy fl
  left join tiers_normalizados t
    on t.client_id = fl.client_id
   and t.clave_tier = public.tier_norm(fl.nombre)
  group by fl.client_id, fl.fuente_id
)
insert into public.medios_suscripcion (
  client_id, fuente_id, tier, prioritario, origen, vigente_desde, updated_at
)
select client_id, fuente_id, tier, prioritario, 'manual_legacy', public.v4_hoy(), now()
from suscripciones
on conflict (client_id, fuente_id) do update
set tier = coalesce(excluded.tier, public.medios_suscripcion.tier),
    prioritario = public.medios_suscripcion.prioritario or excluded.prioritario,
    updated_at = now();

-- Las seis vistas entregan al recolector la URL, formato, método y transporte
-- de la sección. Para las fuentes existentes, los NULL conservan exactamente
-- el comportamiento anterior del dominio.
create or replace view public.v4_recoleccion_pendientes as
select f.id as fuente_id, f.dominio_norm,
       coalesce(nullif(f.url_feed, ''), e.url_recurso) as url,
       coalesce(f.formato, e.formato) as formato,
       coalesce(f.transporte, e.transporte) as transporte,
       coalesce(f.metodo_extraccion, e.metodo_extraccion) as metodo_extraccion
from public.medios_fuentes f
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where f.activa is true
  and coalesce(f.metodo_extraccion, e.metodo_extraccion) = 'feed'
  and coalesce(f.transporte, e.transporte) is not null
  and coalesce(nullif(f.url_feed, ''), e.url_recurso) like 'http%'
  and not exists (
    select 1 from public.fetch_log l
    where l.fuente_id = f.id and l.fecha = public.v4_hoy()
      and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD_HH24')
  )
order by f.dominio_norm, f.seccion;

create or replace view public.v4_recoleccion_html_pendientes as
select f.id as fuente_id, f.dominio_norm,
       coalesce(nullif(f.url_feed, ''), e.url_recurso, 'https://' || f.dominio_norm) as url,
       coalesce(f.transporte, e.transporte) as transporte
from public.medios_fuentes f
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where f.activa is true
  and coalesce(f.metodo_extraccion, e.metodo_extraccion) = 'html'
  and coalesce(f.transporte, e.transporte) is not null
  and not exists (
    select 1 from public.fetch_log l
    where l.fuente_id = f.id and l.fecha = public.v4_hoy()
      and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD_HH24')
  )
order by f.dominio_norm, f.seccion;

create or replace view public.v4_recoleccion_prioritaria_pendientes as
select f.id as fuente_id, f.dominio_norm,
       coalesce(nullif(f.url_feed, ''), e.url_recurso) as url,
       coalesce(f.formato, e.formato) as formato,
       coalesce(f.transporte, e.transporte) as transporte,
       coalesce(f.metodo_extraccion, e.metodo_extraccion) as metodo_extraccion
from public.medios_fuentes f
join public.v4_fuentes_prioritarias p on p.fuente_id = f.id
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where coalesce(f.metodo_extraccion, e.metodo_extraccion) = 'feed'
  and coalesce(f.transporte, e.transporte) is not null
  and coalesce(nullif(f.url_feed, ''), e.url_recurso) like 'http%'
  and not exists (
    select 1 from public.fetch_log l
    where l.fuente_id = f.id and l.fecha = public.v4_hoy()
      and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD_HH24')
  )
order by f.dominio_norm, f.seccion;

create or replace view public.v4_recoleccion_html_prioritaria_pendientes as
select f.id as fuente_id, f.dominio_norm,
       coalesce(nullif(f.url_feed, ''), e.url_recurso, 'https://' || f.dominio_norm) as url,
       coalesce(f.transporte, e.transporte) as transporte
from public.medios_fuentes f
join public.v4_fuentes_prioritarias p on p.fuente_id = f.id
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where coalesce(f.metodo_extraccion, e.metodo_extraccion) = 'html'
  and coalesce(f.transporte, e.transporte) is not null
  and not exists (
    select 1 from public.fetch_log l
    where l.fuente_id = f.id and l.fecha = public.v4_hoy()
      and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD_HH24')
  )
order by f.dominio_norm, f.seccion;

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
      and l.pasada = 'prueba_completa_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
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
      and l.pasada = 'prueba_completa_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
  )
order by f.dominio_norm, f.seccion;

grant select on public.v4_recoleccion_pendientes,
                public.v4_recoleccion_html_pendientes,
                public.v4_recoleccion_prioritaria_pendientes,
                public.v4_recoleccion_html_prioritaria_pendientes,
                public.v4_recoleccion_completa_prueba_pendientes,
                public.v4_recoleccion_html_completa_prueba_pendientes
to anon, authenticated, service_role;
