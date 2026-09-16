-- Permite limpiar fetch_log sin escanear todas las candidatas para poner
-- fetch_log_id en NULL por la FK ON DELETE SET NULL.
create index if not exists candidatas_raw_fetch_log_id_idx
  on public.candidatas_raw (fetch_log_id);
