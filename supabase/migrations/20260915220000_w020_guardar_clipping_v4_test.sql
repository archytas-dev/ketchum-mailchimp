-- [W0.20] `v4_test_guardar_clipping` — armar, guardar y devolver el id, en un viaje.
--
-- Runbook: docs/pipeline-v4/roadmap-webapp-v4.md §3.6, Paso 4.
-- La llama el nodo nuevo "Guardar clipping v4 (test)" de `wf/armado-cliente` (ORrmePsGxJJxISTo).
--
-- POR QUÉ UNA FUNCIÓN Y NO DOS NODOS
-- El nodo que construye el HTML del mail referencia por nombre al nodo que le da el JSON.
-- Meter nodos en el medio obligaba a tocar ese Code node, que es grande y tiene los templates
-- de render adentro. Con esta función, el nodo existente conserva su nombre y su forma de
-- salida, y sólo cambia de dónde lee: de `v4_test_armar_clipping()` (un JSON paralelo) a
-- `clipping_v4_json()` (lo guardado). El constructor de HTML no se tocó.
--
-- EL NIVEL DE SALIDA
-- `v4_test_armar_clipping()` no devuelve `nivel_salida` ni `nivel_motivo`: los produce
-- `decidir_nivel()`. Sin inyectarlos acá, `clippings_v4.nivel_salida` quedaba NULL y `[W1.7]`
-- —la franja de nivel en /hoy— no tendría de dónde leer. Se toman de `test.v4_pipeline_runs`.

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

  v_clip := v_clip || jsonb_build_object('nivel_salida', v_nivel, 'nivel_motivo', v_motivo);

  v_imp := public.import_clipping_v4(v_clip, p_run_id::text, 'test');

  return v_imp || jsonb_build_object('run_id', p_run_id, 'nivel_salida', v_nivel, 'nivel_motivo', v_motivo);
end;
$fn$;

revoke all on function public.v4_test_guardar_clipping(uuid) from public, anon, authenticated;
grant execute on function public.v4_test_guardar_clipping(uuid) to service_role;

comment on function public.v4_test_guardar_clipping(uuid) is
  '[W0.20] Arma el clipping v4 de una corrida test y lo guarda con import_clipping_v4. Devuelve clipping_id, nivel y contadores. Destino fijo: test.';

-- ---------------------------------------------------------------------------
-- VERIFICADO 15/09 con corridas reales del dia
--   BMS     run 09745593… -> 91 notas · orden 1..91 sin huecos · nivel 0 "completo"
--   Booking run 06c55056… -> 112 notas · orden 1..112 sin huecos
--   Reimportar la misma corrida: mismo clipping_id, mismas notas (idempotente).
--   Baseline v3 (5 tablas) idéntico antes y después.
-- ---------------------------------------------------------------------------
