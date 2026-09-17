-- Actividad busca el último fetch de cada fuente dentro de la ventana del run.
-- Sin este índice, BMS hacía un recorrido del log por cada fuente y el snapshot
-- podía superar el timeout aunque el clipping ya hubiera terminado bien.

create index if not exists fetch_log_fuente_ts_desc_idx
  on public.fetch_log (fuente_id, ts desc);
