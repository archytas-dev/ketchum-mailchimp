-- [W0.23c] Consolidar las secciones/fuentes repetidas antes de guardar un medio por corrida.

begin;

create or replace function public.v4_test_snapshot_actividad(p_run_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, test
as $fn$
declare r test.v4_pipeline_runs%rowtype;
begin
  select * into r from test.v4_pipeline_runs where id=p_run_id;
  if not found then raise exception 'corrida test inexistente' using errcode='22023'; end if;
  delete from test.v4_run_medios where run_id=p_run_id;
  delete from test.v4_run_keywords where run_id=p_run_id;

  insert into test.v4_run_medios(run_id,fuente_id,dominio_norm,ok,outcome,http_status,diagnostico,articulos,ms,fetched_at)
  select p_run_id,x.fuente_id,x.dominio_norm,
    case when x.bloqueado then false when x.fetch_id is null then false when x.http_status between 200 and 399 and coalesce(x.articulos,0)>0 then true else false end,
    case when x.bloqueado then 'configured_blocked' when x.fetch_id is null then 'budget_skip'
         when x.http_status between 200 and 399 and coalesce(x.articulos,0)>0 then 'ok'
         when x.http_status between 200 and 399 then 'empty'
         when nullif(x.diagnostico,'') is not null then x.diagnostico else 'exception' end,
    x.http_status,x.diagnostico,x.articulos,x.ms,x.ts
  from (
    select distinct on (coalesce(f.dominio_norm,s.fuente_id::text))
      s.fuente_id,coalesce(f.dominio_norm,s.fuente_id::text) as dominio_norm,
      coalesce(s.bloqueado,false) as bloqueado,l.id as fetch_id,l.http_status,l.diagnostico,l.articulos,l.ms,l.ts
    from public.medios_suscripcion s
    left join public.medios_fuentes f on f.id=s.fuente_id
    left join lateral (
      select fl.* from public.fetch_log fl where fl.fuente_id=s.fuente_id
        and fl.ts >= r.arranco_at - interval '24 hours' and fl.ts <= coalesce(r.termino_at,now())
      order by fl.ts desc limit 1
    ) l on true
    where s.client_id=r.client_id
    order by coalesce(f.dominio_norm,s.fuente_id::text), l.ts desc nulls last, s.fuente_id
  ) x;

  insert into test.v4_run_keywords(run_id,keyword,grupo,activa,matches)
  select p_run_id,k.keyword,k.grupo,k.activa,
    count(distinct pc.candidata_id) filter (where public.txt_fold(coalesce(cr.titulo,'') || ' ' || coalesce(cr.snippet,'')) like '%' || public.txt_fold(k.keyword) || '%')::integer
  from public.kw_keywords k
  left join test.v4_pipeline_run_candidatas pc on pc.run_id=p_run_id
  left join public.candidatas_raw cr on cr.id=pc.candidata_id
  where k.client_id=r.client_id group by k.keyword,k.grupo,k.activa;

  return jsonb_build_object('run_id',p_run_id,'medios',(select count(*) from test.v4_run_medios where run_id=p_run_id),'keywords',(select count(*) from test.v4_run_keywords where run_id=p_run_id));
end;
$fn$;

commit;
