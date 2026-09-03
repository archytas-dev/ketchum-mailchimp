-- Pipeline v4 · Poblado inicial de catalogo/fuentes/estrategia/suscripcion desde `medios`.
-- Solo INSERT en las tablas nuevas (vacias). NO toca `medios`. Idempotente (on conflict).
-- Aplicado a produccion el 2026-09-03.
--
-- Se excluyen 236 filas `sin-dominio:*` (altas donde no se pudo parsear el dominio) -> ticket aparte.
-- 148 dominios con `metodo` distinto por cliente: se resuelve por prioridad rss>sitemap>jina>manual_review.
--
-- Resultado: catalogo 1542 · fuentes 1542 (1 portada c/u) · estrategia 1437 · suscripcion 2201.

-- 1. catalogo
insert into medios_catalogo (dominio_norm, nombre, estado)
select
  regexp_replace(lower(btrim(m.dominio)), '^www\.', '') as dn,
  (array_agg(m.nombre order by (m.nombre is null), length(coalesce(m.nombre,'')) desc))[1] as nombre,
  case when bool_or(m.activo) then 'activo' else 'pausado' end as estado
from medios m
where m.dominio is not null and m.dominio not ilike 'sin-dominio:%' and m.dominio ~ '\.'
group by 1
on conflict (dominio_norm) do nothing;

-- 2. fuentes: una "portada" por dominio, formato resuelto por prioridad
insert into medios_fuentes (dominio_norm, seccion, formato, url_feed, activa)
select
  c.dominio_norm, 'portada',
  case agg.metodo
    when 'rss'     then 'rss'
    when 'sitemap' then 'sitemap'
    when 'jina'    then 'html'
    else null
  end as formato,
  agg.url_feed,
  (agg.metodo is not null and agg.metodo <> 'manual_review') as activa
from medios_catalogo c
cross join lateral (
  select
    case
      when bool_or(m.metodo = 'rss')           then 'rss'
      when bool_or(m.metodo = 'sitemap')        then 'sitemap'
      when bool_or(m.metodo = 'jina')           then 'jina'
      when bool_or(m.metodo = 'manual_review')  then 'manual_review'
      else null
    end as metodo,
    (array_agg(m.url_feed order by (m.url_feed is null)))[1] as url_feed
  from medios m
  where regexp_replace(lower(btrim(m.dominio)), '^www\.', '') = c.dominio_norm
) agg
on conflict (dominio_norm, lower(seccion)) do nothing;

-- 3. estrategia: semilla. Fase 2 (descubridor) la reescribe con lo que realmente funciona.
insert into medios_estrategia (dominio_norm, formato, transporte, url_recurso)
select f.dominio_norm, f.formato,
       case when f.formato = 'html' then 'jina' else null end,
       f.url_feed
from medios_fuentes f
where f.formato is not null
on conflict (dominio_norm) do nothing;

-- 4. suscripcion: una fila por (cliente, dominio) del set limpio -> fuente portada
insert into medios_suscripcion (client_id, fuente_id, origen, bloqueado)
select m.client_id, f.id, m.origen, not coalesce(m.activo, true)
from medios m
join medios_fuentes f
  on f.dominio_norm = regexp_replace(lower(btrim(m.dominio)), '^www\.', '')
 and f.seccion = 'portada'
where m.dominio is not null and m.dominio not ilike 'sin-dominio:%' and m.dominio ~ '\.'
on conflict (client_id, fuente_id) do nothing;
