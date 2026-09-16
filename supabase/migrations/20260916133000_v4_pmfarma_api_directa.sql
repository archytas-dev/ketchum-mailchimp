-- PMFarma no publica RSS: /app/noticias es una SPA sin notas en HTML.
-- Su API publica entrega el listado con fecha/titulo; se consulta directo,
-- sin proxy ni navegador. `formato` describe el parser, no el transporte.
alter table public.medios_estrategia
  drop constraint if exists medios_estrategia_formato_check;
alter table public.medios_estrategia
  add constraint medios_estrategia_formato_check
  check (formato in ('rss', 'wordpress', 'sitemap', 'html', 'google_news', 'api_pmfarma'));

alter table public.medios_fuentes
  drop constraint if exists medios_fuentes_formato_check;
alter table public.medios_fuentes
  add constraint medios_fuentes_formato_check
  check (formato in ('rss', 'wordpress', 'sitemap', 'html', 'google_news', 'api_pmfarma'));

update public.medios_estrategia
set url_recurso = 'https://api.pmfarma.com/api/noticias-paginated',
    formato = 'api_pmfarma',
    transporte = 'directo',
    metodo_extraccion = 'feed',
    ultimo_diagnostico = null,
    updated_at = now()
where dominio_norm = 'pmfarma.com';

update public.medios_fuentes
set url_feed = 'https://api.pmfarma.com/api/noticias-paginated',
    formato = 'api_pmfarma',
    transporte = 'directo',
    metodo_extraccion = 'feed',
    updated_at = now()
where id = '70a36dfa-d12c-4756-b9ae-4152405fc82d';
