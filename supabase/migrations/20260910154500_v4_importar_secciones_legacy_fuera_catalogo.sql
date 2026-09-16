-- Completa la recuperación de secciones activas de v3 cuyos dominios no habían
-- quedado en medios_catalogo. Son todas adicionales: entran a las pruebas
-- completas, pero no se vuelven prioridad diaria por este alta.

with legacy as (
  select
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm,
    nullif(btrim(m.nombre), '') as nombre
  from public.medios m
  where m.activo and m.tipo in ('monitoreado', 'adicional')
    and nullif(btrim(m.url_feed), '') like 'http%'
    and lower(coalesce(m.metodo, '')) in ('rss', 'sitemap', 'wordpress', 'jina')
)
insert into public.medios_catalogo (dominio_norm, nombre, estado, notas, updated_at)
select dominio_norm, min(nombre), 'activo', 'Importado desde configuración activa de v3 al recuperar secciones.', now()
from legacy l
where not exists (select 1 from public.medios_catalogo c where c.dominio_norm = l.dominio_norm)
group by dominio_norm;

with legacy as (
  select distinct on (dominio_norm)
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm,
    btrim(m.url_feed) as url_feed,
    lower(coalesce(m.metodo, '')) as metodo
  from public.medios m
  where m.activo and m.tipo in ('monitoreado', 'adicional')
    and nullif(btrim(m.url_feed), '') like 'http%'
    and lower(coalesce(m.metodo, '')) in ('rss', 'sitemap', 'wordpress', 'jina')
  order by dominio_norm, case when lower(coalesce(m.metodo,'')) in ('rss','sitemap','wordpress') then 0 else 1 end, btrim(m.url_feed)
)
insert into public.medios_estrategia (dominio_norm, formato, transporte, url_recurso, metodo_extraccion, updated_at)
select dominio_norm,
       case metodo when 'rss' then 'rss' when 'sitemap' then 'sitemap' when 'wordpress' then 'wordpress' else 'html' end,
       'directo', url_feed,
       case when metodo='jina' then 'html' else 'feed' end, now()
from legacy
on conflict (dominio_norm) do nothing;

with legacy as (
  select
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm,
    btrim(m.url_feed) as url_feed,
    lower(regexp_replace(regexp_replace(btrim(m.url_feed), '^https?://(www[.])?', '', 'i'), '/+$', '')) as url_norm,
    lower(coalesce(m.metodo, '')) as metodo
  from public.medios m
  where m.activo and m.tipo in ('monitoreado', 'adicional')
    and nullif(btrim(m.url_feed), '') like 'http%'
    and lower(coalesce(m.metodo, '')) in ('rss', 'sitemap', 'wordpress', 'jina')
), elegidas as (
  select distinct on (dominio_norm, url_norm) dominio_norm,url_feed,url_norm,metodo
  from legacy order by dominio_norm,url_norm,case when metodo in ('rss','sitemap','wordpress') then 0 else 1 end,url_feed
)
insert into public.medios_fuentes (dominio_norm,seccion,formato,url_feed,metodo_extraccion,activa,updated_at)
select dominio_norm, 'v3/' || substring(md5(dominio_norm || '/' || url_norm) from 1 for 12),
       case metodo when 'rss' then 'rss' when 'sitemap' then 'sitemap' when 'wordpress' then 'wordpress' else 'html' end,
       url_feed, case when metodo='jina' then 'html' else 'feed' end, true, now()
from elegidas
on conflict (dominio_norm, lower(seccion)) do nothing;

with legacy as (
  select m.client_id,
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm,
    lower(regexp_replace(regexp_replace(btrim(m.url_feed), '^https?://(www[.])?', '', 'i'), '/+$', '')) as url_norm,
    m.tipo,m.nombre
  from public.medios m
  where m.activo and m.tipo in ('monitoreado','adicional')
    and nullif(btrim(m.url_feed),'') like 'http%'
    and lower(coalesce(m.metodo,'')) in ('rss','sitemap','wordpress','jina')
), tiers_normalizados as (
  select client_id, public.tier_norm(dominio) as clave_tier, min(tier) as tier
  from public.tiers where tier is not null group by client_id, public.tier_norm(dominio)
), suscripciones as (
  select l.client_id,f.id as fuente_id,max(t.tier) as tier,bool_or(l.tipo='monitoreado') as prioritario
  from legacy l join public.medios_fuentes f on f.dominio_norm=l.dominio_norm
    and f.seccion='v3/' || substring(md5(l.dominio_norm || '/' || l.url_norm) from 1 for 12)
  left join tiers_normalizados t on t.client_id=l.client_id and t.clave_tier=public.tier_norm(l.nombre)
  group by l.client_id,f.id
)
insert into public.medios_suscripcion (client_id,fuente_id,tier,prioritario,origen,vigente_desde,updated_at)
select client_id,fuente_id,tier,prioritario,'manual_legacy',public.v4_hoy(),now() from suscripciones
on conflict (client_id,fuente_id) do update set
  tier=coalesce(excluded.tier,public.medios_suscripcion.tier),
  prioritario=public.medios_suscripcion.prioritario or excluded.prioritario,
  updated_at=now();
