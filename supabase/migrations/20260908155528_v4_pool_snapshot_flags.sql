
alter table public.pipeline_runs
  add column if not exists pool_materializado_at timestamptz;
alter table public.pipeline_runs
  add column if not exists pool_total bigint;
alter table public.pipeline_runs
  add column if not exists pool_es_muestra boolean not null default false;
alter table public.pipeline_run_candidatas
  add column if not exists es_prioritaria boolean not null default false;
