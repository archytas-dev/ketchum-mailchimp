-- KET-49 / Feedback Fedra (11/08/2026): la solapa "Reporte de errores" pide un formulario con
-- Cliente + Fecha + Tipo de error + Descripcion. Faltaban dos cosas en la tabla:
--
-- 1) FECHA. El ticket original resolvia la fecha via `clipping_id`, pero el reporte llega
--    muchas veces sin saber a que clipping corresponde ("el jueves pasado salio mal") y hay
--    reportes que no son de un clipping puntual. Se agrega `fecha` como dato propio: es lo que
--    el usuario escribe, y `clipping_id` sigue siendo el vinculo fuerte cuando existe.
--
-- 2) TIPOS. Fedra nombro cuatro casos y solo dos existian en el check. Se suman `nota_extra`
--    ("noticia extra") y `formato` ("error de formato", que engloba sin_subtitulo/doble_link
--    para el que reporta -- distinguir cual de los dos es trabajo nuestro, no suyo).
--    Los valores viejos se conservan: son los que usa el TDD y no hay filas que migrar (0 hoy),
--    pero borrar valores de un check es romper compatibilidad hacia atras sin necesidad.

alter table reportes add column if not exists fecha date;

-- La fecha del reporte: si vino atado a un clipping, la del clipping; si no, hoy.
comment on column reportes.fecha is
  'Fecha del clipping al que se refiere el reporte, segun quien lo carga. Puede no coincidir con created_at.';

alter table reportes drop constraint if exists reportes_tipo_check;
alter table reportes add constraint reportes_tipo_check check (tipo in (
  -- los cuatro que nombro Fedra
  'falta_nota',          -- noticia que no entro
  'nota_extra',          -- noticia que no correspondia
  'seccion_incorrecta',  -- noticia mal categorizada
  'formato',             -- error de formato (subtitulo, links, estilos)
  -- preexistentes (TDD): mas finos, los usa staff al clasificar
  'sin_subtitulo',
  'doble_link',
  'medio_extranjero',
  'duplicada',
  'otro'
));

create index if not exists reportes_client_fecha_idx on reportes (client_id, fecha desc);
