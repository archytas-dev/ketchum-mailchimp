-- Un sitemap indice no es un feed vacio: es un sitemap DE sitemaps, y para sacar
-- notas hay que seguir a un hijo. Llamarlo 'sin_items' mezclaba dos casos con
-- arreglos opuestos —uno se resuelve solo con otra URL, el otro no se resuelve—
-- y por eso 25 fuentes quedaron paradas creyendo que eran feeds vacios.
--
-- El vocabulario de diagnostico es cerrado a proposito (asi nadie inventa
-- etiquetas sueltas), asi que sumar un caso nuevo es sumarlo aca tambien.
alter table public.fetch_log drop constraint if exists fetch_log_diagnostico_check;
alter table public.fetch_log add constraint fetch_log_diagnostico_check
  check (diagnostico = any (array[
    'ok','bloqueado','sin_items','no_es_feed','no_existe','caido',
    'timeout','rate_limit','no_visitado','error','sitemap_index'
  ]::text[]));

comment on column public.fetch_log.diagnostico is
  'Vocabulario cerrado. sitemap_index = respondio un <sitemapindex>: hay que apuntar la fuente a uno de sus hijos, no es que el feed este vacio.';