-- La pestaña Actividad apareció vacía para BMS el 18/09: 0 medios, 0 keywords y 0 notas en
-- "Casi entraron". Los otros tres clientes sí tenían todo.
--
-- Causa: la foto de Actividad la genera v4_test_snapshot_actividad, que en n8n cuelga de un
-- IF con la condición `entrega === 'test'`. Con `entrega = public_v4` ese paso se saltea.
-- Después v4_snapshot_operacion_public copia de test a public, y si en test no hay nada,
-- copia nada.
--
-- Lo que salvó a Mars, Booking y MSD fue una casualidad: la cadena del PREARMADO corre con
-- entrega='test' (sus nodos no mandan `entrega`, así que cae al default), y si es esa cadena
-- la que termina el pool, la foto se genera. Si llega a terminarlo la corrida del cliente
-- —que va con public_v4— no se genera. Para BMS pasó lo segundo.
--
-- O sea que hoy funcionaba o no según cuál de las dos cadenas ganara la carrera. Salió 3 de 4
-- por suerte y mañana le puede tocar a cualquiera.
--
-- El arreglo va del lado de la base y no de n8n, a propósito: así no depende del orden en que
-- n8n resuelva las dos ramas que salen de "Armar, auditar y decidir nivel". Quien guarda el
-- clipping público genera la foto y después la copia, siempre, en el mismo llamado.
--
-- Costo medido: v4_test_snapshot_actividad tarda ~9 s para BMS (822 medios, 108 keywords).
-- El nodo que llama a esta función tiene timeout de 60 s y hoy tarda ~1,2 s, así que entra
-- con margen. Aun así la generación va envuelta: ese nodo NO tiene neverError, y si fallara
-- cortaría el mail del cliente. El clipping y el mail valen más que la proyección de
-- Actividad, así que un fallo acá se registra en v4_errores y sigue.

create or replace function public.v4_public_guardar_clipping_run(p_run_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_payload jsonb;
  v_result jsonb;
  v_nivel int;
  v_motivo text;
  v_clipping_id uuid;
  v_client_id uuid;
begin
  v_payload := public.v4_test_armar_clipping(p_run_id);
  if v_payload is null or coalesce(jsonb_typeof(v_payload->'secciones'), '(ausente)') <> 'array' then
    raise exception 'v4_test_armar_clipping no devolvio un clipping usable para run %', p_run_id
      using errcode='no_data_found';
  end if;

  select nivel_salida, detalle->>'motivo', client_id
    into v_nivel, v_motivo, v_client_id
    from test.v4_pipeline_runs where id=p_run_id;
  if not found then
    raise exception 'corrida v4 interna inexistente: %', p_run_id using errcode='no_data_found';
  end if;

  v_payload := v_payload || jsonb_build_object(
    'run_id', p_run_id, 'nivel_salida', v_nivel, 'nivel_motivo', v_motivo
  );
  v_result := public.import_clipping_v4(v_payload, p_run_id::text, 'public_v4');
  v_clipping_id := (v_result->>'clipping_id')::uuid;

  -- Genera la foto de Actividad (medios, keywords y traza del auditor) en test. Antes esto
  -- dependía de que la cadena de prearmado de n8n llegara primero; ahora siempre corre acá.
  begin
    perform public.v4_test_snapshot_actividad(p_run_id);
  exception when others then
    insert into public.v4_errores (workflow, nodo, mensaje, detalle, client_id)
    values ('v4_public_guardar_clipping_run', 'v4_test_snapshot_actividad',
            left(sqlerrm, 500),
            jsonb_build_object('run_id', p_run_id, 'sqlstate', sqlstate),
            v_client_id);
  end;

  perform public.v4_snapshot_operacion_public(p_run_id, v_clipping_id);
  return v_result || jsonb_build_object('run_id',p_run_id);
end;
$function$;
