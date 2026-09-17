-- [W0.23g] Una misma fuente puede estar suscripta dos veces por cliente.
-- Para Actividad se toma una sola foto por fuente (prioriza la no bloqueada),
-- sin tocar la configuración compartida ni la operación v3.

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
  delete from test.v4_candidatas_traza where run_id=p_run_id and etapa='auditor';

  insert into test.v4_run_medios(run_id,fuente_id,dominio_norm,ok,outcome,http_status,diagnostico,articulos,ms,fetched_at)
  with suscripciones as (
    select distinct on (s0.fuente_id) s0.*
    from public.medios_suscripcion s0
    where s0.client_id=r.client_id
    order by s0.fuente_id, coalesce(s0.bloqueado,false) asc
  )
  select p_run_id,s.fuente_id,lower(trim(coalesce(f.dominio_norm,s.fuente_id::text))),
    case when coalesce(s.bloqueado,false) then false when l.id is null then false when l.http_status between 200 and 399 and coalesce(l.articulos,0)>0 then true else false end,
    case when coalesce(s.bloqueado,false) then 'configured_blocked' when l.id is null then 'budget_skip'
         when l.http_status between 200 and 399 and coalesce(l.articulos,0)>0 then 'ok'
         when l.http_status between 200 and 399 then 'empty'
         when nullif(l.diagnostico,'') is not null then l.diagnostico else 'exception' end,
    l.http_status,l.diagnostico,l.articulos,l.ms,l.ts
  from suscripciones s
  left join public.medios_fuentes f on f.id=s.fuente_id
  left join lateral (
    select fl.* from public.fetch_log fl where fl.fuente_id=s.fuente_id
      and fl.ts >= r.arranco_at - interval '24 hours' and fl.ts <= coalesce(r.termino_at,now())
    order by fl.ts desc limit 1
  ) l on true;

  insert into test.v4_run_keywords(run_id,keyword,grupo,activa,matches)
  select p_run_id,k.keyword,k.grupo,k.activa,
    count(distinct pc.candidata_id) filter (where public.txt_fold(coalesce(cr.titulo,'') || ' ' || coalesce(cr.snippet,'')) like '%' || public.txt_fold(k.keyword) || '%')::integer
  from public.kw_keywords k
  left join test.v4_pipeline_run_candidatas pc on pc.run_id=p_run_id
  left join public.candidatas_raw cr on cr.id=pc.candidata_id
  where k.client_id=r.client_id group by k.keyword,k.grupo,k.activa;

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
    select a.*, rk.rn from aprobadas a left join ranked rk on rk.candidata_id=a.candidata_id
  )
  select p_run_id,c.candidata_id,'auditor',
    case when c.baja_confianza or c.rn>1 then 'descarta' else 'continua' end,
    case when c.baja_confianza then 'Último filtro: confianza inferior al mínimo BMS (0,85).'
         when c.rn>1 then 'Último filtro: repetida de otra nota aprobada; se conserva una sola versión.'
         else 'Superó el último filtro y llegó al clipping.' end,
    jsonb_strip_nulls(jsonb_build_object(
      'regla',case when c.baja_confianza then 'confianza_minima_bms' when c.rn>1 then 'deduplicacion_clipping' else 'continua' end,
      'recuperable',c.baja_confianza,'confianza',c.confianza,'forzada',c.forzada,'orden_dedup',c.rn
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

commit;
