-- [F3.6] La estrategia de transporte es una foto, y envejece sola: un medio que hoy
-- entra por Cloudflare puede dejar de entrar mañana. Sin re-verificación el recolector
-- empieza a fallar en silencio.
--
-- Esta vista dice a quién hay que re-probar: las fuentes cuyo ÚLTIMO intento falló con
-- un diagnóstico que la escalera puede resolver.
--
-- Qué NO entra, a propósito:
--   sin_items   -- el feed es válido y está vacío. No es una falla y cambiar de
--                  transporte no lo arregla (decisión 11 del roadmap).
--   no_es_feed  -- la URL apunta a otra cosa: es trabajo del descubridor, no de la escalera.
--   no_existe   -- 404: la URL murió. Va a baja, no a reintento.

create or replace view public.v4_estrategia_a_reverificar as
with ultimo as (
  select distinct on (l.fuente_id)
         l.fuente_id, l.diagnostico, l.transporte, l.ts
  from public.fetch_log l
  where l.pasada like 'barrido_%'
  order by l.fuente_id, l.ts desc
)
select
  f.id                as fuente_id,
  f.dominio_norm,
  coalesce(e.url_recurso, f.url_feed) as url,
  e.formato,
  e.transporte        as transporte_actual,
  u.diagnostico       as ultimo_diagnostico,
  coalesce(e.fallos_consecutivos, 0) as fallos_consecutivos,
  u.ts                as ultimo_intento
from ultimo u
join public.medios_fuentes f    on f.id = u.fuente_id and f.activa is true
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where u.diagnostico in ('bloqueado','caido','timeout','rate_limit','error')
  and e.metodo_extraccion = 'feed'
  and coalesce(e.url_recurso, f.url_feed) like 'http%'
order by coalesce(e.fallos_consecutivos, 0) desc, f.dominio_norm;

comment on view public.v4_estrategia_a_reverificar is
  'Fuentes cuyo último intento falló con algo que la escalera puede resolver (bloqueado, caido, timeout, rate_limit, error). Excluye sin_items (feed válido vacío: no es falla), no_es_feed (trabajo del descubridor) y no_existe (va a baja). Ordenada por fallos acumulados: primero las que vienen fallando hace más tiempo.';
