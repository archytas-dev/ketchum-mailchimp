-- [F3.7] Las 178 fuentes con metodo_extraccion='html' se salteaban bien, pero se
-- salteaban EN SILENCIO: no aparecían en fetch_log, así que un día roto y un día
-- sin esas fuentes se veían igual. Es exactamente lo que la v4 existe para evitar.
--
-- Ahora entran a la vista de pendientes y el recolector las registra como
-- 'no_visitado' sin salir a buscarlas, igual que las de brightdata.
--
-- Por qué NO se les pone transporte='html': eso volvería a mezclar los dos ejes que
-- [F2.7] separó. En fetch_log quedan con transporte NULL, y quien quiera saber por
-- qué no se visitaron cruza con medios_estrategia.metodo_extraccion.
--
-- Y no se les exige URL: a las 130 que vienen de la v3 no se les conoce ninguna, y
-- justamente por eso hay que verlas.

create or replace view public.v4_recoleccion_pendientes as
select
  f.id            as fuente_id,
  f.dominio_norm,
  coalesce(e.url_recurso, f.url_feed) as url,
  e.formato,
  e.transporte,
  e.metodo_extraccion
from public.medios_fuentes f
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where f.activa is true
  and (
        -- se puede traer: hay red conocida y hay a dónde pegarle
        ( e.metodo_extraccion = 'feed'
          and e.transporte is not null
          and coalesce(e.url_recurso, f.url_feed) like 'http%' )
        -- no se puede traer todavía, pero se registra: espera sub/open-article
        or e.metodo_extraccion = 'html'
      )
  and not exists (
        select 1 from public.fetch_log l
        where l.fuente_id = f.id
          and l.fecha = current_date
          and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM-DD_HH24')
      )
order by e.metodo_extraccion, f.dominio_norm;

comment on view public.v4_recoleccion_pendientes is
  'Lo que el barrido de la hora actual todavía no intentó. Incluye las metodo_extraccion=html a propósito: no se salen a buscar (no hay feed) pero se registran en fetch_log como no_visitado, para que no desaparezcan en silencio. Excluye cualquier intento previo de la misma ventana, ande o no, así cada fuente se pide una vez por barrido y la vista converge a vacío.';
