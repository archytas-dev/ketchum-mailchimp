-- [W0.23f] Actividad v4: separar el rechazo del juez del último filtro real.
--
-- El juez decide relevancia. Después, al armar el clipping, hay dos descartes
-- adicionales: calidad mínima BMS y deduplicación. V3 mostraba esa capa como
-- "Casi entraron"; sin esta bitácora v4 sólo podía mostrar miles de rechazos
-- del juez, que no son accionables.

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
  -- Esta etapa se reconstruye desde los veredictos; nunca borra juez/preselección.
  delete from test.v4_candidatas_traza where run_id=p_run_id and etapa='auditor';

  insert into test.v4_run_medios(run_id,fuente_id,dominio_norm,ok,outcome,http_status,diagnostico,articulos,ms,fetched_at)
  select p_run_id,s.fuente_id,lower(trim(coalesce(f.dominio_norm,s.fuente_id::text))),
    case when coalesce(s.bloqueado,false) then false when l.id is null then false when l.http_status between 200 and 399 and coalesce(l.articulos,0)>0 then true else false end,
    case when coalesce(s.bloqueado,false) then 'configured_blocked' when l.id is null then 'budget_skip'
         when l.http_status between 200 and 399 and coalesce(l.articulos,0)>0 then 'ok'
         when l.http_status between 200 and 399 then 'empty'
         when nullif(l.diagnostico,'') is not null then l.diagnostico else 'exception' end,
    l.http_status,l.diagnostico,l.articulos,l.ms,l.ts
  from public.medios_suscripcion s
  left join public.medios_fuentes f on f.id=s.fuente_id
  left join lateral (
    select fl.* from public.fetch_log fl where fl.fuente_id=s.fuente_id
      and fl.ts >= r.arranco_at - interval '24 hours' and fl.ts <= coalesce(r.termino_at,now())
    order by fl.ts desc limit 1
  ) l on true
  where s.client_id=r.client_id;

  insert into test.v4_run_keywords(run_id,keyword,grupo,activa,matches)
  select p_run_id,k.keyword,k.grupo,k.activa,
    count(distinct pc.candidata_id) filter (where public.txt_fold(coalesce(cr.titulo,'') || ' ' || coalesce(cr.snippet,'')) like '%' || public.txt_fold(k.keyword) || '%')::integer
  from public.kw_keywords k
  left join test.v4_pipeline_run_candidatas pc on pc.run_id=p_run_id
  left join public.candidatas_raw cr on cr.id=pc.candidata_id
  where k.client_id=r.client_id group by k.keyword,k.grupo,k.activa;

  -- Reproduce literalmente la última capa de v4_test_armar_clipping().
  -- "recuperable" es false para una repetida: recuperarla agregaría basura duplicada.
  insert into test.v4_candidatas_traza(run_id,candidata_id,etapa,resultado,motivo,detalle,updated_at)
  with contexto as (
    select lower(coalesce(c.slug,'')) as slug from public.clients c where c.id=r.client_id
  ), aprobadas as (
    select v.candidata_id, v.titulo, v.confianza, v.forzada, cr.url,
      ((select slug from contexto)='bms' and not coalesce(v.forzada,false) and coalesce(v.confianza,0)<0.85) as baja_confianza
    from test.v4_candidatas_veredicto v
    join public.candidatas_raw cr on cr.id=v.candidata_id
    where v.run_id=p_run_id and v.entra
  ), ranked as (
    select a.*, row_number() over (
      partition by coalesce(
        nullif(public.v4_keyword_norm(coalesce(a.titulo,'')), ''),
        case when nullif(a.url,'') is not null then 'url:' || lower(regexp_replace(a.url, '[?#].*$', '', 'g')) else 'id:' || a.candidata_id::text end
      )
      order by a.forzada desc, a.confianza desc nulls last, a.candidata_id
    ) as rn
    from aprobadas a where not a.baja_confianza
  ), clasificacion as (
    select a.*, rk.rn
    from aprobadas a left join ranked rk on rk.candidata_id=a.candidata_id
  )
  select p_run_id,c.candidata_id,'auditor',
    case when c.baja_confianza or c.rn>1 then 'descarta' else 'continua' end,
    case when c.baja_confianza then 'Último filtro: confianza inferior al mínimo BMS (0,85).'
         when c.rn>1 then 'Último filtro: repetida de otra nota aprobada; se conserva una sola versión.'
         else 'Superó el último filtro y llegó al clipping.' end,
    jsonb_strip_nulls(jsonb_build_object(
      'regla',case when c.baja_confianza then 'confianza_minima_bms' when c.rn>1 then 'deduplicacion_clipping' else 'continua' end,
      'recuperable',c.baja_confianza,
      'confianza',c.confianza,
      'forzada',c.forzada,
      'orden_dedup',c.rn
    )),now()
  from clasificacion c;

  return jsonb_build_object(
    'run_id',p_run_id,
    'medios',(select count(*) from test.v4_run_medios where run_id=p_run_id),
    'keywords',(select count(*) from test.v4_run_keywords where run_id=p_run_id),
    'ultimo_filtro_descartadas',(select count(*) from test.v4_candidatas_traza where run_id=p_run_id and etapa='auditor' and resultado='descarta')
  );
end;
$fn$;

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
  if not exists (
    select 1 from test.v4_candidatas_traza t
    where t.run_id=p_run_id and t.candidata_id=p_candidata_id
      and ((t.etapa='juez' and t.resultado='descarta') or (t.etapa='auditor' and t.resultado='descarta' and coalesce((t.detalle->>'recuperable')::boolean,false)))
  ) then raise exception 'la candidata no es recuperable en esta corrida' using errcode='22023'; end if;
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
