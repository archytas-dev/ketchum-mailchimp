-- BMS: tier, alcance y Ad Value se muestran solo en secciones configuradas
-- con `muestra_ad_value=true` (hoy, Notas Exclusivas).
--
-- La valorizacion sigue viviendo por medio en v4_valorizaciones_medio/tiers.
-- Este cambio solo evita que se copie o se exponga en sectores donde no
-- corresponde. Aplica a test y public_v4.

create or replace function public.v4_test_armar_clipping(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path to 'test','public' as $function$
with run as (
  select * from test.v4_pipeline_runs where id=p_run_id
), notas as (
  select v.candidata_id,v.seccion,v.confianza,v.forzada,
    coalesce(v.titulo,c.titulo) as titulo,coalesce(v.snippet,c.snippet) as snippet,
    c.url,c.dominio_norm,coalesce(v.fecha_pub,c.fecha_pub) as fecha_pub,
    coalesce(v.fecha_confiable,c.fecha_confiable) as fecha_confiable,
    coalesce(vv.ad_value,t.ad_value,td.ad_value) as ad_value,
    coalesce(vv.tier,t.tier,ms.tier) as tier,
    coalesce(vv.alcance,t.alcance) as alcance,
    coalesce(mc.nombre,t.medio,c.dominio_norm) as medio,
    coalesce(sec.muestra_ad_value,false) as muestra_ad_value
  from test.v4_candidatas_veredicto v
  join run r on r.id=v.run_id
  join public.candidatas_raw c on c.id=v.candidata_id
  left join public.secciones sec on sec.client_id=r.client_id and sec.nombre=v.seccion
  left join public.medios_suscripcion ms on ms.client_id=r.client_id and ms.fuente_id=c.fuente_id
  left join public.medios_catalogo mc on mc.dominio_norm=c.dominio_norm
  left join public.v4_valorizaciones_medio vv on vv.client_id=r.client_id and vv.dominio_norm=c.dominio_norm
  left join public.tiers t on t.client_id=r.client_id
    and public.tier_norm(t.dominio)=public.tier_norm(coalesce(mc.nombre,c.dominio_norm))
  left join public.tier_defaults td on td.client_id=r.client_id and td.tier=coalesce(vv.tier,t.tier,ms.tier)
  where v.run_id=p_run_id and v.entra
), por_seccion as (
  select s.nombre,s.orden,s.es_exclusiva,s.muestra_ad_value,
    coalesce(jsonb_agg(jsonb_build_object(
      'candidata_id',n.candidata_id,'titulo',n.titulo,'snippet',n.snippet,'url',n.url,
      'medio',n.medio,'dominio',n.dominio_norm,'fecha_pub',n.fecha_pub,
      'fecha_confiable',n.fecha_confiable,
      'tier',case when s.muestra_ad_value then n.tier else null end,
      'alcance',case when s.muestra_ad_value then n.alcance else null end,
      'ad_value',case when s.muestra_ad_value then n.ad_value else null end,
      'confianza',n.confianza,'forzada',n.forzada
    ) order by case when s.muestra_ad_value then n.ad_value end desc nulls last,
      n.fecha_pub desc nulls last,n.titulo)
      filter(where n.candidata_id is not null),'[]'::jsonb) as notas,
    count(n.candidata_id) as cantidad,
    coalesce(sum(n.ad_value) filter(where s.muestra_ad_value),0) as ad_value_seccion,
    count(*) filter(where s.muestra_ad_value and n.ad_value is null and n.candidata_id is not null) as sin_valorizar
  from public.secciones s join run r on r.client_id=s.client_id
  left join notas n on n.seccion=s.nombre where s.activa
  group by s.nombre,s.orden,s.es_exclusiva,s.muestra_ad_value
)
select jsonb_build_object(
  'run_id',p_run_id,'client_id',(select client_id from run),'fecha',(select fecha from run),'modo','test',
  'total_notas',(select count(*) from notas),
  'ad_value_total',(select coalesce(sum(ad_value) filter(where muestra_ad_value),0) from notas),
  'sin_valorizar',(select count(*) from notas where muestra_ad_value and ad_value is null),
  'forzadas',(select count(*) from notas where forzada),
  'secciones',coalesce((select jsonb_agg(jsonb_build_object(
    'nombre',ps.nombre,'orden',ps.orden,'es_exclusiva',ps.es_exclusiva,'muestra_ad_value',ps.muestra_ad_value,
    'cantidad',ps.cantidad,'ad_value',ps.ad_value_seccion,'sin_valorizar',ps.sin_valorizar,'notas',ps.notas
  ) order by ps.orden) from por_seccion ps),'[]'::jsonb)
);
$function$;

revoke all on function public.v4_test_armar_clipping(uuid) from public,anon;
grant execute on function public.v4_test_armar_clipping(uuid) to authenticated,service_role;

-- El importador vuelve a aplicar la regla aunque reciba un payload armado por
-- otra ruta. Así ninguna inserción futura de test/public_v4 puede guardar la
-- valorización visible de una sección que no la muestra.
create or replace function public.import_clipping_v4(
  p_clipping jsonb,
  p_run_id text default null,
  p_destino text default 'test'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_schema text;
  v_client_id uuid;
  v_fecha date;
  v_clip uuid;
  v_n8n int := 0;
  v_precarga int := 0;
  v_dedup_url int := 0;
  v_pisadas int := 0;
  v_preservadas int := 0;
begin
  if p_destino is null or p_destino not in ('test', 'public_v4') then
    raise exception 'destino no permitido: %', p_destino using errcode = 'invalid_parameter_value';
  end if;
  v_schema := case when p_destino = 'test' then 'test' else 'public' end;
  if p_clipping is null or jsonb_typeof(p_clipping) <> 'object'
     or coalesce(jsonb_typeof(p_clipping->'secciones'), '(ausente)') <> 'array' then
    raise exception 'payload invalido para import_clipping_v4' using errcode = 'invalid_parameter_value';
  end if;
  v_client_id := nullif(p_clipping->>'client_id','')::uuid;
  v_fecha := nullif(p_clipping->>'fecha','')::date;
  if v_client_id is null or v_fecha is null then
    raise exception 'payload sin client_id o fecha' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.clients where id=v_client_id and slug like '%-legado') then
    raise exception 'cliente legado no permitido' using errcode = 'invalid_parameter_value';
  end if;

  drop table if exists _notas_v4;
  create temp table _notas_v4 on commit drop as
  with plano as (
    select (s.value->>'orden')::int seccion_orden, s.ord s_ord, n.ord n_ord,
      s.value->>'nombre' seccion, nullif(n.value->>'candidata_id','')::uuid candidata_id,
      n.value->>'titulo' titulo, n.value->>'snippet' snippet, n.value->>'url' url,
      n.value->>'medio' medio, n.value->>'dominio' dominio,
      (nullif(n.value->>'fecha_pub','')::timestamptz at time zone 'America/Argentina/Buenos_Aires')::date pub_date,
      (n.value->>'fecha_confiable')::boolean fecha_confiable,
      case when coalesce(sec.muestra_ad_value,false) then nullif(n.value->>'tier','')::int end tier,
      case when coalesce(sec.muestra_ad_value,false) then nullif(n.value->>'alcance','')::bigint end alcance,
      case when coalesce(sec.muestra_ad_value,false) then nullif(n.value->>'ad_value','')::bigint end ad_value,
      nullif(n.value->>'confianza','')::numeric confianza,
      coalesce((n.value->>'forzada')::boolean,false) forzada, n.value->>'motivo_forzada' motivo_forzada,
      public.url_canonica(n.value->>'url') url_canon
    from jsonb_array_elements(p_clipping->'secciones') with ordinality s(value,ord)
    cross join lateral jsonb_array_elements(coalesce(s.value->'notas','[]'::jsonb)) with ordinality n(value,ord)
    left join public.secciones sec on sec.client_id=v_client_id and sec.nombre=s.value->>'nombre'
    where coalesce(n.value->>'titulo','') <> ''
  ), unicas as (
    select p.*, row_number() over (partition by nullif(url_canon,'') order by seccion_orden,n_ord) rn_url from plano p
  ) select row_number() over (order by seccion_orden,s_ord,n_ord)::int orden,
      seccion,titulo,snippet,url,medio,dominio,pub_date,fecha_confiable,tier,alcance,ad_value,confianza,forzada,motivo_forzada,candidata_id,url_canon
    from unicas where rn_url=1 or nullif(url_canon,'') is null;
  select count(*) into v_n8n from _notas_v4;
  v_dedup_url := (select count(*) from jsonb_array_elements(p_clipping->'secciones') s cross join lateral jsonb_array_elements(coalesce(s->'notas','[]'::jsonb)) n where coalesce(n->>'titulo','') <> '') - v_n8n;

  execute format($q$insert into %I.clippings_v4 (client_id,fecha,estado,n8n_run_id,run_id,nivel_salida,nivel_motivo,pipeline_version,updated_at)
    values ($1,$2,'borrador',$3,$4,$5,$6,'v4',now())
    on conflict (client_id,fecha) do update set n8n_run_id=excluded.n8n_run_id,run_id=excluded.run_id,nivel_salida=excluded.nivel_salida,nivel_motivo=excluded.nivel_motivo,updated_at=now()
    returning id$q$,v_schema) using v_client_id,v_fecha,p_run_id,nullif(p_clipping->>'run_id','')::uuid,nullif(p_clipping->>'nivel_salida','')::int,p_clipping->>'nivel_motivo' into v_clip;
  execute format('delete from %I.notes_v4 where clipping_id=$1 and origen=''n8n''',v_schema) using v_clip;
  execute format($q$insert into %I.notes_v4 (clipping_id,seccion,medio,titulo,snippet,url,pub_date,ad_value,orden,incluida,origen,candidata_id,dominio,fecha_confiable,confianza,forzada,motivo_forzada,tier,alcance)
    select $1,seccion,medio,titulo,snippet,url,pub_date,ad_value,orden,true,'n8n',candidata_id,dominio,fecha_confiable,confianza,forzada,motivo_forzada,tier,alcance from _notas_v4$q$,v_schema) using v_clip;
  execute format($q$insert into %I.notes_v4 (clipping_id,seccion,medio,titulo,snippet,url,pub_date,ad_value,orden,incluida,origen,tier,alcance)
    select $1,p.seccion,p.medio,p.titulo,p.snippet,p.url,p.pub_date,
      case when coalesce(s.muestra_ad_value,false) then p.ad_value else null end,
      $2 + row_number() over(order by p.orden,p.created_at),true,'cliente',
      case when coalesce(s.muestra_ad_value,false) then p.tier else null end,
      case when coalesce(s.muestra_ad_value,false) then p.alcance else null end
    from %I.notes_precarga_v4 p
    left join public.secciones s on s.client_id=p.client_id and s.nombre=p.seccion
    where p.client_id=$3 and p.fecha=$4 and p.consumed_at is null$q$,v_schema,v_schema) using v_clip,v_n8n,v_client_id,v_fecha;
  get diagnostics v_precarga = row_count;
  execute format('update %I.notes_precarga_v4 set consumed_at=now() where client_id=$1 and fecha=$2 and consumed_at is null',v_schema) using v_client_id,v_fecha;
  execute format($q$delete from %I.notes_v4 n8 using %I.notes_v4 cl where n8.clipping_id=$1 and cl.clipping_id=$1 and n8.origen='n8n' and cl.origen<>'n8n' and ((nullif(public.url_canonica(n8.url),'') is not null and public.url_canonica(n8.url)=public.url_canonica(cl.url)) or public.txt_fold(n8.titulo)=public.txt_fold(cl.titulo))$q$,v_schema,v_schema) using v_clip;
  get diagnostics v_pisadas = row_count;
  execute format($q$with base as (select count(*) n from %I.notes_v4 where clipping_id=$1 and origen='n8n'), reasignadas as (select id,(select n from base)+row_number() over(order by orden,created_at) nuevo from %I.notes_v4 where clipping_id=$1 and origen<>'n8n') update %I.notes_v4 t set orden=r.nuevo from reasignadas r where t.id=r.id and t.orden is distinct from r.nuevo$q$,v_schema,v_schema,v_schema) using v_clip;
  execute format('select count(*) from %I.notes_v4 where clipping_id=$1 and origen<>''n8n''',v_schema) using v_clip into v_preservadas;
  return jsonb_build_object('ok',true,'destino',p_destino,'clipping_id',v_clip,'client_id',v_client_id,'fecha',v_fecha,'notas_n8n',v_n8n-v_pisadas,'notas_del_equipo',v_preservadas,'precarga_volcada',v_precarga,'descartadas_por_url_repetida',v_dedup_url,'pisadas_por_el_equipo',v_pisadas);
end;
$fn$;

revoke all on function public.import_clipping_v4(jsonb,text,text) from public, anon, authenticated;
grant execute on function public.import_clipping_v4(jsonb,text,text) to service_role;

-- El lector vuelve a filtrar también los clippings ya guardados antes de este
-- fix. Esto evita que una corrida vieja siga mostrando metadatos en sectores.
create or replace function public.clipping_v4_json(
  p_clipping_id uuid,
  p_destino text default 'test'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_schema text;
  v_modo text;
  v_res jsonb;
begin
  if p_destino is null or p_destino not in ('test','public_v4') then
    raise exception 'destino no permitido: %', p_destino using errcode='invalid_parameter_value';
  end if;
  v_schema := case when p_destino='test' then 'test' else 'public' end;
  v_modo := case when p_destino='test' then 'test' else 'prod' end;
  execute format($q$
    select jsonb_build_object(
      'client_id',c.client_id,'fecha',c.fecha,'modo',$2,'clipping_id',c.id,'run_id',c.run_id,
      'nivel_salida',c.nivel_salida,'nivel_motivo',c.nivel_motivo,
      'origen_json','clipping_v4_json (lo guardado)','total_notas',coalesce(tot.n,0),
      'ad_value_total',coalesce(tot.ad,0),'sin_valorizar',coalesce(tot.sv,0),
      'forzadas',coalesce(tot.fz,0),'secciones',coalesce(sec.arr,'[]'::jsonb)
    )
    from %I.clippings_v4 c
    left join lateral (
      select count(*) n,
             coalesce(sum(case when coalesce(s2.muestra_ad_value,false) then n2.ad_value end),0) ad,
             count(*) filter(where coalesce(s2.muestra_ad_value,false) and n2.ad_value is null) sv,
             count(*) filter(where n2.forzada) fz
      from %I.notes_v4 n2
      left join public.secciones s2 on s2.client_id=c.client_id and s2.nombre=n2.seccion
      where n2.clipping_id=c.id and n2.incluida
    ) tot on true
    left join lateral (
      select jsonb_agg(x.obj order by x.orden_seccion) arr from (
        select min(n3.orden) orden_seccion,
          jsonb_build_object(
            'nombre',coalesce(n3.seccion,'(sin seccion)'),
            'orden',row_number() over(order by min(n3.orden)),
            'es_exclusiva',coalesce(bool_or(s.es_exclusiva),false),
            'muestra_ad_value',coalesce(bool_or(s.muestra_ad_value),false),
            'cantidad',count(*),
            'ad_value',coalesce(sum(case when coalesce(s.muestra_ad_value,false) then n3.ad_value end),0),
            'sin_valorizar',count(*) filter(where coalesce(s.muestra_ad_value,false) and n3.ad_value is null),
            'notas',jsonb_agg(jsonb_build_object(
              'candidata_id',n3.candidata_id,'titulo',n3.titulo,'snippet',n3.snippet,
              'url',n3.url,'medio',n3.medio,'dominio',n3.dominio,'fecha_pub',n3.pub_date,
              'fecha_confiable',n3.fecha_confiable,
              'tier',case when coalesce(s.muestra_ad_value,false) then n3.tier else null end,
              'alcance',case when coalesce(s.muestra_ad_value,false) then n3.alcance else null end,
              'ad_value',case when coalesce(s.muestra_ad_value,false) then n3.ad_value else null end,
              'confianza',n3.confianza,'forzada',n3.forzada,
              'motivo_forzada',n3.motivo_forzada,'orden',n3.orden,'origen',n3.origen
            ) order by n3.orden)
          ) obj
        from %I.notes_v4 n3
        left join public.secciones s on s.client_id=c.client_id and s.nombre=n3.seccion
        where n3.clipping_id=c.id and n3.incluida
        group by coalesce(n3.seccion,'(sin seccion)')
      ) x
    ) sec on true
    where c.id=$1$q$,v_schema,v_schema,v_schema)
  using p_clipping_id,v_modo into v_res;
  if v_res is null then
    raise exception 'no existe el clipping v4 % en %',p_clipping_id,p_destino using errcode='no_data_found';
  end if;
  return v_res;
end;
$fn$;

revoke all on function public.clipping_v4_json(uuid,text) from public, anon, authenticated;
grant execute on function public.clipping_v4_json(uuid,text) to service_role;
