create or replace function public.v4_abrir_run(
  p_client_id uuid,
  p_modo text default 'test',
  p_fecha date default null,
  p_trigger text default 'manual',
  p_rehacer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fecha date := coalesce(p_fecha, v4_hoy());
  v_modo text := case when p_modo = 'prod' then 'prod' else 'test' end;
  v_run pipeline_runs%rowtype;
begin
  select * into v_run
  from pipeline_runs
  where client_id = p_client_id
    and fecha = v_fecha
    and modo = v_modo;

  if found then
    if p_rehacer then
      -- El resultado v4 se identifica por cliente, fecha y modo; al rehacer
      -- se elimina solo ese resultado y se conserva la fila de la corrida.
      delete from candidatas_veredicto
      where client_id = p_client_id
        and fecha = v_fecha
        and modo = v_modo;

      delete from pipeline_run_candidatas
      where run_id = v_run.id;

      update pipeline_runs
         set estado = 'corriendo',
             arranco_at = now(),
             termino_at = null,
             nivel_salida = null,
             detalle = null,
             pool_materializado_at = null,
             pool_total = null,
             pool_es_muestra = false,
             trigger = p_trigger
       where id = v_run.id;

      return jsonb_build_object(
        'run_id', v_run.id,
        'ya_corrio', false,
        'fecha', v_fecha,
        'motivo', 'se fuerza una nueva corrida y se limpia el resultado anterior'
      );
    end if;

    if v_run.estado = 'ok' then
      return jsonb_build_object(
        'run_id', v_run.id,
        'ya_corrio', true,
        'estado', v_run.estado,
        'nivel', v_run.nivel_salida,
        'fecha', v_fecha,
        'motivo', 'ya hay una corrida terminada para este cliente y dia'
      );
    end if;

    update pipeline_runs
       set estado = 'corriendo',
           arranco_at = now(),
           termino_at = null,
           trigger = p_trigger
     where id = v_run.id;

    return jsonb_build_object(
      'run_id', v_run.id,
      'ya_corrio', false,
      'fecha', v_fecha,
      'motivo', case when v_run.estado = 'degradado'
        then 'se reanuda una corrida degradada y se procesan solo pendientes'
        else 'se reusa una corrida previa que no habia terminado' end
    );
  end if;

  insert into pipeline_runs (client_id, fecha, modo, trigger, arranco_at, estado)
  values (p_client_id, v_fecha, v_modo, p_trigger, now(), 'corriendo')
  returning * into v_run;

  return jsonb_build_object(
    'run_id', v_run.id,
    'ya_corrio', false,
    'fecha', v_fecha,
    'motivo', 'corrida nueva'
  );
end;
$function$;

comment on function public.v4_abrir_run(uuid, text, date, text, boolean) is
  'Abre una corrida v4. Por defecto no rehace una corrida terminada; p_rehacer=true limpia solo el resultado test/prod de ese cliente y fecha para repetirla.';

grant execute on function public.v4_abrir_run(uuid, text, date, text, boolean)
  to anon, authenticated, service_role;

