-- La v3 mantiene los tiers por nombre de medio, no por dominio: tiers.dominio
-- contiene valores como "la voz del interior". Se usa el cruce exacto con
-- tier_norm. La auditoría previa encontró cero casos que requieran tier_alias y
-- cero fuentes con más de un tier, por eso no se inventa un match aproximado.
with tiers_normalizados as materialized (
  select client_id, tier_norm(dominio) as clave_tier, tier
  from tiers
  where tier is not null
),
medios_normalizados as materialized (
  select
    m.client_id,
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www\.', '', 'i'), '/.*$', '')) as dominio_norm,
    tier_norm(m.nombre) as clave_tier
  from medios m
  where m.activo
),
tier_por_fuente as (
  select
    m.client_id,
    f.id as fuente_id,
    min(t.tier) as tier
  from medios_normalizados m
  join tiers_normalizados t
    on t.client_id = m.client_id
   and t.clave_tier = m.clave_tier
  join medios_fuentes f on f.dominio_norm = m.dominio_norm
  group by m.client_id, f.id
)
update medios_suscripcion s
set tier = p.tier,
    updated_at = now()
from tier_por_fuente p
where s.client_id = p.client_id
  and s.fuente_id = p.fuente_id
  and s.tier is distinct from p.tier;

-- Una fuente se recolecta una vez para todos. Es prioritaria si es monitoreada
-- en la configuración activa de v3 de al menos un cliente, o si tiene tier en
-- una suscripción activa. Los bloqueos se respetan: no se deshace una decisión
-- de negocio por una migración de cobertura.
create or replace view v4_fuentes_prioritarias as
with monitoreadas as (
  select distinct
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www\.', '', 'i'), '/.*$', '')) as dominio_norm
  from medios m
  where m.activo
    and m.tipo = 'monitoreado'
),
con_tier as (
  select distinct f.id as fuente_id
  from medios_suscripcion s
  join medios_fuentes f on f.id = s.fuente_id
  where coalesce(s.bloqueado, false) = false
    and s.tier is not null
)
select f.id as fuente_id, f.dominio_norm
from medios_fuentes f
where f.activa
  and (
    exists (select 1 from monitoreadas m where m.dominio_norm = f.dominio_norm)
    or exists (select 1 from con_tier t where t.fuente_id = f.id)
  );

-- Se crean vistas nuevas para no tomar un lock sobre las que están usando los
-- barridos actuales. Los recolectores se apuntan a estas vistas en la misma
-- publicación; la paginación y la exclusión por pasada se preservan intactas.
create view v4_recoleccion_prioritaria_pendientes as
select f.id as fuente_id,
       f.dominio_norm,
       coalesce(e.url_recurso, f.url_feed) as url,
       e.formato,
       e.transporte,
       e.metodo_extraccion
from medios_fuentes f
join v4_fuentes_prioritarias p on p.fuente_id = f.id
join medios_estrategia e on e.dominio_norm = f.dominio_norm
where e.metodo_extraccion = 'feed'
  and e.transporte is not null
  and coalesce(e.url_recurso, f.url_feed) like 'http%'
  and not exists (
    select 1
    from fetch_log l
    where l.fuente_id = f.id
      and l.fecha = v4_hoy()
      and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD_HH24')
  )
order by f.dominio_norm;

create view v4_recoleccion_html_prioritaria_pendientes as
select f.id as fuente_id,
       f.dominio_norm,
       coalesce(e.url_recurso, 'https://' || f.dominio_norm) as url,
       e.transporte
from medios_fuentes f
join v4_fuentes_prioritarias p on p.fuente_id = f.id
join medios_estrategia e on e.dominio_norm = f.dominio_norm
where e.metodo_extraccion = 'html'
  and e.transporte is not null
  and not exists (
    select 1
    from fetch_log l
    where l.fuente_id = f.id
      and l.fecha = v4_hoy()
      and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD_HH24')
  )
order by f.dominio_norm;
