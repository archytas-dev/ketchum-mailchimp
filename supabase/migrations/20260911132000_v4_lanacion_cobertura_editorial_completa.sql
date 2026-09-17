-- La Nación no expone un feed único que cubra de forma estable todas sus áreas.
-- Sumamos todos los sitemaps editoriales publicados por el propio medio, más
-- Agencias como HTML. Esto reemplaza la falsa fuente RSS que apuntaba a
-- /sociedad/ y evita depender sólo de los 60 ítems de portada.

-- El remoto tenia este padre de catalogo como alta previa. En una base nueva
-- debe existir antes de insertar las subsecciones que lo referencian.
insert into public.medios_catalogo (dominio_norm, nombre, estado)
values ('lanacion.com.ar', 'La Nacion Sociedad — Jina', 'activo')
on conflict (dominio_norm) do nothing;

update public.medios_fuentes
set activa = false,
    updated_at = now()
where dominio_norm = 'lanacion.com.ar'
  and url_feed = 'https://www.lanacion.com.ar/sociedad/'
  and formato = 'rss';

with nuevas(seccion, formato, url_feed, metodo_extraccion, transporte) as (
  values
    ('ln/articulos-actuales', 'sitemap', 'https://www.lanacion.com.ar/sitemap-articles-0.xml', 'feed', 'cloudflare'),
    ('ln/articulos-anteriores', 'sitemap', 'https://www.lanacion.com.ar/sitemap-articles-1.xml', 'feed', 'cloudflare'),
    ('ln/agencias', 'html', 'https://www.lanacion.com.ar/agencias/', 'html', 'cloudflare'),
    ('ln/que-sale', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/que-sale/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/salud', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/salud/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/tecnologia', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/tecnologia/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/opinion', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/opinion/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/propiedades', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/propiedades/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/videos', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/videos/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/revista-hola', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/revista-hola/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/revista-jardin', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/revista-jardin/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/revista-living', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/revista-living/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/revista-lugares', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/revista-lugares/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/sabado', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/sabado/?outputType=xml', 'feed', 'cloudflare'),
    ('ln/recetas', 'sitemap', 'https://www.lanacion.com.ar/arc/outboundfeeds/sitemap/category/recetas/?outputType=xml', 'feed', 'cloudflare')
), insertadas as (
  insert into public.medios_fuentes (
    dominio_norm, seccion, formato, url_feed, metodo_extraccion, transporte, activa, updated_at
  )
  select 'lanacion.com.ar', seccion, formato, url_feed, metodo_extraccion, transporte, true, now()
  from nuevas
  on conflict (dominio_norm, lower(seccion)) do update
  set formato = excluded.formato,
      url_feed = excluded.url_feed,
      metodo_extraccion = excluded.metodo_extraccion,
      transporte = excluded.transporte,
      activa = true,
      updated_at = now()
  returning id
), clientes_monitoreados as (
  select distinct m.client_id
  from public.medios m
  where m.activo is true
    and m.tipo = 'monitoreado'
    and lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) = 'lanacion.com.ar'
), fuentes_nuevas as (
  select f.id
  from public.medios_fuentes f
  where f.dominio_norm = 'lanacion.com.ar'
    and f.seccion like 'ln/%'
)
insert into public.medios_suscripcion (
  client_id, fuente_id, tier, prioritario, origen, vigente_desde, updated_at
)
select c.client_id, f.id, null, true, 'lanacion_cobertura_editorial', public.v4_hoy(), now()
from clientes_monitoreados c
cross join fuentes_nuevas f
on conflict (client_id, fuente_id) do update
set prioritario = true,
    origen = excluded.origen,
    updated_at = now();
