-- [W0.22] Lectura de actividad v4 para la preview aislada.
-- No toca telemetria, descartes ni actividad de la v3.

begin;

grant select on test.v4_pipeline_runs, test.v4_candidatas_traza to authenticated;

drop policy if exists v4_runs_actividad_lectura on test.v4_pipeline_runs;
create policy v4_runs_actividad_lectura on test.v4_pipeline_runs
  for select to authenticated
  using (public.is_staff() or public.has_client_access(client_id));

drop policy if exists v4_traza_actividad_lectura on test.v4_candidatas_traza;
create policy v4_traza_actividad_lectura on test.v4_candidatas_traza
  for select to authenticated
  using (
    exists (
      select 1 from test.v4_pipeline_runs r
      where r.id = run_id
        and (public.is_staff() or public.has_client_access(r.client_id))
    )
  );

commit;
