-- Índices de las FKs que se recorren al borrar una candidata vieja.
-- Sin ellos, cada DELETE de candidatas_raw tenía que escanear tablas hijas
-- completas para ejecutar los ON DELETE CASCADE.
create index if not exists candidatas_veredicto_candidata_id_idx
  on public.candidatas_veredicto (candidata_id);

create index if not exists pipeline_run_candidatas_candidata_id_idx
  on public.pipeline_run_candidatas (candidata_id);

create index if not exists test_v4_veredicto_candidata_id_idx
  on test.v4_candidatas_veredicto (candidata_id);

create index if not exists test_v4_pipeline_run_candidatas_candidata_id_idx
  on test.v4_pipeline_run_candidatas (candidata_id);
