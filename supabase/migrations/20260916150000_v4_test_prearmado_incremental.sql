-- Prearmado incremental del plano v4/test.
-- Una corrida por cliente/dia permanece viva: nuevas candidatas se agregan al
-- final y nunca se vuelven a juzgar si ya tienen veredicto en ese run.

create or replace function public.v4_test_abrir_run(
  p_client_id uuid, p_fecha date default null, p_trigger text default 'manual', p_run_id uuid default null
) returns jsonb language plpgsql security definer set search_path to test, public as $fn$
declare v_run test.v4_pipeline_runs%rowtype; v_fecha date := coalesce(p_fecha, public.v4_hoy());
begin
  if p_run_id is not null then
    select * into v_run from test.v4_pipeline_runs where id=p_run_id and client_id=p_client_id;
  else
    select * into v_run from test.v4_pipeline_runs
     where client_id=p_client_id and fecha=v_fecha order by arranco_at desc limit 1;
  end if;
  if found then
    update test.v4_pipeline_runs set estado='corriendo', termino_at=null, trigger=p_trigger where id=v_run.id;
    return jsonb_build_object('run_id',v_run.id,'ya_corrio',false,'fecha',v_run.fecha,'motivo','prearmado incremental: se reutiliza la corrida del dia');
  end if;
  insert into test.v4_pipeline_runs(client_id,fecha,trigger) values(p_client_id,v_fecha,p_trigger) returning * into v_run;
  return jsonb_build_object('run_id',v_run.id,'ya_corrio',false,'fecha',v_run.fecha,'motivo','corrida test diaria nueva');
end $fn$;

create or replace function public.v4_test_materializar_candidatas(p_run_id uuid, p_tope integer default null)
returns jsonb language plpgsql security definer set search_path to test, public set statement_timeout to '120s' as $fn$
declare v_run test.v4_pipeline_runs%rowtype; v_nuevas integer:=0; v_total bigint:=0; v_base bigint:=0;
begin
  select * into v_run from test.v4_pipeline_runs where id=p_run_id for update;
  if not found then raise exception 'corrida test inexistente: %',p_run_id using errcode='22023'; end if;
  select coalesce(max(orden),0) into v_base from test.v4_pipeline_run_candidatas where run_id=p_run_id;
  insert into test.v4_pipeline_run_candidatas(run_id,candidata_id,orden,es_prioritaria)
  select p_run_id,q.candidata_id,v_base + q.rn,q.es_prioritaria
  from (
    select x.*,row_number() over(order by x.es_prioritaria desc,x.fecha_pub desc nulls last,x.candidata_id) as rn
    from public.v4_candidatas_aceptadas_operativo(v_run.client_id,v_run.fecha,false) x
    where not exists(select 1 from test.v4_pipeline_run_candidatas pc where pc.run_id=p_run_id and pc.candidata_id=x.candidata_id)
      and not exists(select 1 from test.v4_candidatas_veredicto cv where cv.run_id=p_run_id and cv.candidata_id=x.candidata_id)
  ) q
  where p_tope is null or (v_base + q.rn) <= greatest(1,p_tope);
  get diagnostics v_nuevas=row_count;
  insert into test.v4_candidatas_traza(run_id,candidata_id,etapa,resultado,motivo,detalle,updated_at)
  select p_run_id,pc.candidata_id,'preseleccion','continua','Prearmado: candidata nueva incorporada al pool diario',jsonb_build_object('orden',pc.orden,'modo','test'),now()
  from test.v4_pipeline_run_candidatas pc where pc.run_id=p_run_id and pc.orden>v_base
  on conflict(run_id,candidata_id,etapa) do update set updated_at=excluded.updated_at;
  select count(*) into v_total from test.v4_pipeline_run_candidatas where run_id=p_run_id;
  update test.v4_pipeline_runs set pool_materializado_at=coalesce(pool_materializado_at,now()),pool_total=v_total,pool_es_muestra=p_tope is not null where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'candidatas_nuevas',v_nuevas,'candidatas',v_total,'incremental',true);
end $fn$;

revoke all on function public.v4_test_abrir_run(uuid,date,text,uuid) from public, anon, authenticated;
revoke all on function public.v4_test_materializar_candidatas(uuid,integer) from public, anon, authenticated;
grant execute on function public.v4_test_abrir_run(uuid,date,text,uuid), public.v4_test_materializar_candidatas(uuid,integer) to service_role;
