-- [F3.3] Deduplicación del pool del día, hecha en la base y no en n8n.
--
-- Por qué acá: el recolector corre ~9 veces por día sobre 1.112 fuentes. Leer el
-- pool entero en memoria para comparar en un nodo Code no escala y además no es
-- atómico — dos barridos solapados insertarían la misma nota. Con columna generada
-- + índice único, el dedup es una propiedad de la tabla: el recolector inserta la
-- URL cruda y la base decide. Idempotente por construcción.
--
-- url_canonica() es IMMUTABLE, así que sirve para columna generada.

-- La columna existe como text plano; se reemplaza por generada (la tabla está vacía).
alter table public.candidatas_raw drop column url_canonica;

alter table public.candidatas_raw
  add column url_canonica text generated always as (public.url_canonica(url)) stored;

-- El dedup del día. Es la regla de la decisión 8 del roadmap, como constraint.
create unique index candidatas_raw_dedup_dia_uk
  on public.candidatas_raw (fecha, url_canonica);

comment on index public.candidatas_raw_dedup_dia_uk is
  'Dedup del pool del día: una URL canónica entra una sola vez por fecha, sin importar cuántos barridos la traigan ni por qué fuente. El recolector inserta con Prefer: resolution=ignore-duplicates.';

comment on column public.candidatas_raw.url_canonica is
  'Generada por url_canonica(url). No se escribe desde n8n: la base la calcula, así los cuatro clientes y todos los barridos usan exactamente la misma definición.';

-- Vista de pendientes del barrido: qué fuentes faltan traer hoy en esta pasada.
-- Mismo patrón que la medición: si una tanda se corta, lo que falta sigue pendiente
-- y la siguiente lo toma. Nada de todo-o-nada.
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
  and e.transporte is not null            -- se conoce una red que funciona
  and e.metodo_extraccion = 'feed'        -- las 'html' esperan sub/open-article
  and coalesce(e.url_recurso, f.url_feed) like 'http%'
  and not exists (
        -- ya se trajo con éxito en esta pasada
        select 1 from public.fetch_log l
        where l.fuente_id = f.id
          and l.fecha = current_date
          and l.pasada = to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM-DD_HH24')
          and l.diagnostico = 'ok'
      )
order by f.dominio_norm;

comment on view public.v4_recoleccion_pendientes is
  'Fuentes que el barrido de la hora actual todavía no trajo con éxito. La pasada se identifica por hora local (ART), así el recolector es reentrante dentro de la misma ventana pero vuelve a recorrer todo en la siguiente.';
