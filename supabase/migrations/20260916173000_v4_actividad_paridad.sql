-- [W0.23] Paridad operativa de Actividad para el plano test v4.
-- Medios, keywords y recuperaciones quedan ligados a una corrida test; v3 no participa.

begin;

create table if not exists test.v4_run_medios (
  run_id uuid not null references test.v4_pipeline_runs(id) on delete cascade,
  fuente_id uuid references public.medios_fuentes(id),
  dominio_norm text not null,
  ok boolean not null default false,
  outcome text not null,
  http_status integer,
  diagnostico text,
  articulos integer,
  ms integer,
  fetched_at timestamptz,
  primary key (run_id, dominio_norm)
);

create table if not exists test.v4_run_keywords (
  run_id uuid not null references test.v4_pipeline_runs(id) on delete cascade,
  keyword text not null,
  grupo text,
  activa boolean not null default true,
  matches integer not null default 0,
  primary key (run_id, keyword)
);

create table if not exists test.v4_recuperaciones (
  run_id uuid not null references test.v4_pipeline_runs(id) on delete cascade,
  candidata_id uuid not null references public.candidatas_raw(id) on delete cascade,
  clipping_id uuid not null references test.clippings_v4(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (run_id, candidata_id)
);

alter table test.v4_run_medios enable row level security;
alter table test.v4_run_medios force row level security;
alter table test.v4_run_keywords enable row level security;
alter table test.v4_run_keywords force row level security;
alter table test.v4_recuperaciones enable row level security;
alter table test.v4_recuperaciones force row level security;
grant select on test.v4_run_medios, test.v4_run_keywords, test.v4_recuperaciones to authenticated;
grant all on test.v4_run_medios, test.v4_run_keywords, test.v4_recuperaciones to service_role;

create policy v4_run_medios_lectura on test.v4_run_medios for select to authenticated using (
  exists (select 1 from test.v4_pipeline_runs r where r.id=run_id and (public.is_staff() or public.has_client_access(r.client_id)))
);
create policy v4_run_keywords_lectura on test.v4_run_keywords for select to authenticated using (
  exists (select 1 from test.v4_pipeline_runs r where r.id=run_id and (public.is_staff() or public.has_client_access(r.client_id)))
);
create policy v4_recuperaciones_lectura on test.v4_recuperaciones for select to authenticated using (
  exists (select 1 from test.v4_pipeline_runs r where r.id=run_id and public.is_staff())
);

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

  insert into test.v4_run_medios
    (run_id, fuente_id, dominio_norm, ok, outcome, http_status, diagnostico, articulos, ms, fetched_at)
  select p_run_id, s.fuente_id, coalesce(f.dominio_norm, s.fuente_id::text),
    case when coalesce(s.bloqueado,false) then false
         when l.id is null then false
         when l.http_status between 200 and 399 and coalesce(l.articulos,0) > 0 then true
         else false end,
    case when coalesce(s.bloqueado,false) then 'configured_blocked'
         when l.id is null then 'budget_skip'
         when l.http_status between 200 and 399 and coalesce(l.articulos,0) > 0 then 'ok'
         when l.http_status between 200 and 399 then 'empty'
         when nullif(l.diagnostico,'') is not null then l.diagnostico
         else 'exception' end,
    l.http_status, l.diagnostico, l.articulos, l.ms, l.ts
  from public.medios_suscripcion s
  left join public.medios_fuentes f on f.id=s.fuente_id
  left join lateral (
    select fl.* from public.fetch_log fl
     where fl.fuente_id=s.fuente_id
       and fl.ts >= r.arranco_at - interval '24 hours'
       and fl.ts <= coalesce(r.termino_at, now())
     order by fl.ts desc limit 1
  ) l on true
  where s.client_id=r.client_id;

  insert into test.v4_run_keywords(run_id, keyword, grupo, activa, matches)
  select p_run_id, k.keyword, k.grupo, k.activa,
    count(distinct pc.candidata_id) filter (
      where public.txt_fold(coalesce(cr.titulo,'') || ' ' || coalesce(cr.snippet,''))
        like '%' || public.txt_fold(k.keyword) || '%'
    )::integer
  from public.kw_keywords k
  left join test.v4_pipeline_run_candidatas pc on pc.run_id=p_run_id
  left join public.candidatas_raw cr on cr.id=pc.candidata_id
  where k.client_id=r.client_id
  group by k.keyword,k.grupo,k.activa;

  return jsonb_build_object(
    'run_id',p_run_id,
    'medios',(select count(*) from test.v4_run_medios where run_id=p_run_id),
    'keywords',(select count(*) from test.v4_run_keywords where run_id=p_run_id)
  );
end;
$fn$;

create or replace function public.v4_test_recuperar_candidata(p_run_id uuid, p_candidata_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, test
as $fn$
declare r test.v4_pipeline_runs%rowtype; c public.candidatas_raw%rowtype; clip uuid; orden integer; seccion text;
begin
  if not public.is_staff() then raise exception 'solo la cuenta dev puede recuperar en v4 test' using errcode='42501'; end if;
  select * into r from test.v4_pipeline_runs where id=p_run_id;
  if not found then raise exception 'corrida inexistente' using errcode='22023'; end if;
  if not exists (select 1 from test.v4_candidatas_traza t where t.run_id=p_run_id and t.candidata_id=p_candidata_id and t.etapa='juez' and t.resultado='descarta') then
    raise exception 'la candidata no fue descartada por el juez de esta corrida' using errcode='22023';
  end if;
  select * into c from public.candidatas_raw where id=p_candidata_id;
  if not found then raise exception 'candidata inexistente' using errcode='22023'; end if;
  select id into clip from test.clippings_v4 where client_id=r.client_id and fecha=r.fecha;
  if clip is null then raise exception 'todavia no hay clipping v4 guardado para esta corrida' using errcode='22023'; end if;
  if exists (select 1 from test.v4_recuperaciones where run_id=p_run_id and candidata_id=p_candidata_id) then
    return jsonb_build_object('ok',true,'clipping_id',clip,'ya_recuperada',true);
  end if;
  select coalesce(max(n.orden),0)+1 into orden from test.notes_v4 n where n.clipping_id=clip;
  select case c.client_id when '99a7b1e3-2b24-4364-a055-be338bfff34a'::uuid then 'Noticias del Sector'
                              when '65170cb4-0646-4602-b5b5-f1b93e6762d4'::uuid then 'Turismo'
                              when '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026'::uuid then 'Salud'
                              else 'Noticias de interés' end into seccion from (select r.client_id) c;
  insert into test.notes_v4(clipping_id,seccion,medio,titulo,snippet,url,pub_date,orden,incluida,origen,candidata_id,dominio,fecha_confiable)
  values(clip,seccion,c.dominio_norm,c.titulo,c.snippet,c.url,c.fecha_pub::date,orden,true,'cliente',c.id,c.dominio_norm,c.fecha_confiable);
  insert into test.v4_recuperaciones(run_id,candidata_id,clipping_id,user_id) values(p_run_id,p_candidata_id,clip,auth.uid());
  return jsonb_build_object('ok',true,'clipping_id',clip,'ya_recuperada',false);
end;
$fn$;

revoke all on function public.v4_test_snapshot_actividad(uuid), public.v4_test_recuperar_candidata(uuid,uuid) from public, anon;
grant execute on function public.v4_test_snapshot_actividad(uuid) to service_role;
grant execute on function public.v4_test_recuperar_candidata(uuid,uuid) to authenticated, service_role;

commit;
