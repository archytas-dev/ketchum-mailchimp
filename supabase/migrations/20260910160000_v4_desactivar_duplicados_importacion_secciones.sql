-- La importación complementaria 20260910154500 debía crear sólo dominios que
-- faltaban del catálogo. Su selección de fuentes no restringió ese conjunto y
-- creó fuentes v3 duplicadas de una fuente preexistente con la misma URL.
-- Se desactivan en lugar de borrarlas: así se conserva la trazabilidad de la
-- prueba que alcanzó a correr, sin que vuelvan a entrar a barridos o clippings.

with duplicadas as (
  select f.id
  from public.medios_fuentes f
  where f.seccion like 'v3/%'
    and f.activa
    and exists (
      select 1
      from public.medios_fuentes base
      where base.dominio_norm = f.dominio_norm
        and base.seccion not like 'v3/%'
        and lower(regexp_replace(regexp_replace(coalesce(base.url_feed, ''), '^https?://(www[.])?', '', 'i'), '/+$', '')) =
            lower(regexp_replace(regexp_replace(coalesce(f.url_feed, ''), '^https?://(www[.])?', '', 'i'), '/+$', ''))
    )
)
update public.medios_suscripcion s
set bloqueado = true,
    motivo_bloqueo = 'duplicado de fuente preexistente; desactivado por recuperación de secciones',
    updated_at = now()
from duplicadas d
where s.fuente_id = d.id
  and s.bloqueado is false;

with duplicadas as (
  select f.id
  from public.medios_fuentes f
  where f.seccion like 'v3/%'
    and f.activa
    and exists (
      select 1
      from public.medios_fuentes base
      where base.dominio_norm = f.dominio_norm
        and base.seccion not like 'v3/%'
        and lower(regexp_replace(regexp_replace(coalesce(base.url_feed, ''), '^https?://(www[.])?', '', 'i'), '/+$', '')) =
            lower(regexp_replace(regexp_replace(coalesce(f.url_feed, ''), '^https?://(www[.])?', '', 'i'), '/+$', ''))
    )
)
update public.medios_fuentes f
set activa = false,
    updated_at = now()
from duplicadas d
where f.id = d.id;
