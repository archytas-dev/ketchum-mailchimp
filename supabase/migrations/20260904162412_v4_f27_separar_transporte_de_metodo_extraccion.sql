-- [F2.7] Separar los dos ejes que la Fase 1 mezcló en medios_estrategia.transporte.
--
-- transporte        = por dónde salgo a internet (directo|cloudflare|aws|brightdata)
-- metodo_extraccion = cómo convierto la fuente en notas (feed|html)
--
-- Son independientes. La v3 los tenía juntos en medios.metodo, donde 'jina' significaba
-- "este medio no tiene feed, se lee la página". La Fase 1 copió metodo -> transporte tal
-- cual, y la consecuencia es concreta: el Switch de sub/fetch-source no tiene rama para
-- 'jina', así que esas 130 fuentes caen en el fallback y se buscan por directo, sin URL.
--
-- El camino 'html' NO es un quinto transporte: lo sirve sub/open-article (Fase 5).

alter table public.medios_estrategia
  add column if not exists metodo_extraccion text;

-- Se deriva de formato, que ya distingue los dos casos correctamente.
update public.medios_estrategia
set metodo_extraccion = case when formato = 'html' then 'html' else 'feed' end
where metodo_extraccion is null;

-- Las 130 de 'jina' pierden el transporte (nunca fue uno) y ganan el método real.
-- Se conserva el motivo: la v3 sí sabe leerlas, la v4 todavía no.
update public.medios_estrategia
set transporte = null,
    ultimo_diagnostico = 'sin_feed_requiere_html',
    updated_at = now()
where transporte = 'jina';

alter table public.medios_estrategia
  alter column metodo_extraccion set default 'feed',
  alter column metodo_extraccion set not null;

alter table public.medios_estrategia
  drop constraint if exists medios_estrategia_metodo_extraccion_check;
alter table public.medios_estrategia
  add constraint medios_estrategia_metodo_extraccion_check
  check (metodo_extraccion in ('feed','html'));

-- 'jina' sale del dominio de transporte: no es una red.
alter table public.medios_estrategia
  drop constraint if exists medios_estrategia_transporte_check;
alter table public.medios_estrategia
  add constraint medios_estrategia_transporte_check
  check (transporte in ('directo','cloudflare','aws','brightdata'));

comment on column public.medios_estrategia.transporte is
  'Red verificada por la que se llega a este dominio: directo|cloudflare|aws|brightdata. NULL = no se conoce ninguna que funcione; el motivo queda en ultimo_diagnostico. Nunca escribir un transporte sin verificar.';

comment on column public.medios_estrategia.metodo_extraccion is
  'Cómo se convierte la fuente en notas: feed (RSS/Atom/sitemap) o html (no tiene feed, hay que leer la página). Eje independiente de transporte. El camino html lo sirve sub/open-article, no un transporte.';
