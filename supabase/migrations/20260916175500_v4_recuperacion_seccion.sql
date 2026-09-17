-- [W0.23e] Corrección de la sección de una candidata recuperada en v4 test.

begin;

create or replace function public.v4_test_recuperar_candidata(p_run_id uuid, p_candidata_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, test
as $fn$
declare r test.v4_pipeline_runs%rowtype; cand public.candidatas_raw%rowtype; clip uuid; orden integer; seccion text;
begin
  if not public.is_staff() then raise exception 'solo la cuenta dev puede recuperar en v4 test' using errcode='42501'; end if;
  select * into r from test.v4_pipeline_runs where id=p_run_id;
  if not found then raise exception 'corrida inexistente' using errcode='22023'; end if;
  if not exists (select 1 from test.v4_candidatas_traza t where t.run_id=p_run_id and t.candidata_id=p_candidata_id and t.etapa='juez' and t.resultado='descarta') then raise exception 'la candidata no fue descartada por el juez de esta corrida' using errcode='22023'; end if;
  select * into cand from public.candidatas_raw where id=p_candidata_id;
  if not found then raise exception 'candidata inexistente' using errcode='22023'; end if;
  select id into clip from test.clippings_v4 where client_id=r.client_id and fecha=r.fecha;
  if clip is null then raise exception 'todavia no hay clipping v4 guardado para esta corrida' using errcode='22023'; end if;
  if exists (select 1 from test.v4_recuperaciones where run_id=p_run_id and candidata_id=p_candidata_id) then return jsonb_build_object('ok',true,'clipping_id',clip,'ya_recuperada',true); end if;
  seccion := case r.client_id
    when '99a7b1e3-2b24-4364-a055-be338bfff34a'::uuid then 'Noticias del Sector'
    when '65170cb4-0646-4602-b5b5-f1b93e6762d4'::uuid then 'Turismo'
    when '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026'::uuid then 'Salud'
    else 'Noticias de interés' end;
  select coalesce(max(n.orden),0)+1 into orden from test.notes_v4 n where n.clipping_id=clip;
  insert into test.notes_v4(clipping_id,seccion,medio,titulo,snippet,url,pub_date,orden,incluida,origen,candidata_id,dominio,fecha_confiable)
  values(clip,seccion,cand.dominio_norm,cand.titulo,cand.snippet,cand.url,cand.fecha_pub::date,orden,true,'cliente',cand.id,cand.dominio_norm,cand.fecha_confiable);
  insert into test.v4_recuperaciones(run_id,candidata_id,clipping_id,user_id) values(p_run_id,p_candidata_id,clip,auth.uid());
  return jsonb_build_object('ok',true,'clipping_id',clip,'ya_recuperada',false);
end;
$fn$;

commit;
