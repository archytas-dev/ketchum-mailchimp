-- [W0.20] fix: el nivel de salida no viajaba al plano v4.
-- v4_test_armar_clipping() no devuelve nivel_salida/nivel_motivo: los produce decidir_nivel().
-- Sin esto, clippings_v4.nivel_salida quedaba null y [W1.7] (la franja de nivel en /hoy) no
-- tendria de donde leer. Se toma de test.v4_pipeline_runs, que ya lo tiene escrito.
create or replace function public.v4_test_guardar_clipping(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_clip   jsonb;
  v_imp    jsonb;
  v_nivel  int;
  v_motivo text;
begin
  v_clip := public.v4_test_armar_clipping(p_run_id);

  if v_clip is null or coalesce(jsonb_typeof(v_clip->'secciones'), '(ausente)') <> 'array' then
    raise exception 'v4_test_armar_clipping no devolvio un clipping usable para run %', p_run_id
      using errcode = 'no_data_found';
  end if;

  select r.nivel_salida, r.detalle->>'motivo'
    into v_nivel, v_motivo
    from test.v4_pipeline_runs r where r.id = p_run_id;

  v_clip := v_clip
         || jsonb_build_object('nivel_salida', v_nivel, 'nivel_motivo', v_motivo);

  v_imp := public.import_clipping_v4(v_clip, p_run_id::text, 'test');

  return v_imp || jsonb_build_object('run_id', p_run_id, 'nivel_salida', v_nivel, 'nivel_motivo', v_motivo);
end;
$fn$;

revoke all on function public.v4_test_guardar_clipping(uuid) from public, anon, authenticated;
grant execute on function public.v4_test_guardar_clipping(uuid) to service_role;
