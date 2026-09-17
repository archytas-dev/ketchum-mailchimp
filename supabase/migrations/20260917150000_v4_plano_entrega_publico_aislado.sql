-- [W0.21] Plano operativo v4: entrega aislada de v3.
--
-- PRECONDICION: las tablas test.*_v4 existen por W0.17 y son el contrato de
-- forma. Esta migracion NO copia datos, NO toca public.clippings ni llama a
-- ningun workflow. Solo crea el destino futuro `public_v4`.

-- El nombre logico public_v4 se materializa como tablas nuevas del schema
-- public: clippings_v4, notes_v4, etc. No reutiliza ninguna tabla legacy.
create table if not exists public.clippings_v4 (like test.clippings_v4 including all);
create table if not exists public.notes_v4 (like test.notes_v4 including all);
create table if not exists public.activity_v4 (like test.activity_v4 including all);
create table if not exists public.exports_v4 (like test.exports_v4 including all);
create table if not exists public.summaries_v4 (like test.summaries_v4 including all);
create table if not exists public.user_clipping_state_v4 (like test.user_clipping_state_v4 including all);
create table if not exists public.notes_precarga_v4 (like test.notes_precarga_v4 including all);
create table if not exists public.reportes_v4 (like test.reportes_v4 including all);

-- LIKE no copia las foreign keys: se declaran explicitas para que ninguna FK
-- cruce hacia test ni hacia las tablas de entrega de v3.
alter table public.clippings_v4
  add constraint clippings_v4_client_fk foreign key (client_id) references public.clients(id);
alter table public.notes_v4
  add constraint notes_v4_clipping_fk foreign key (clipping_id) references public.clippings_v4(id) on delete cascade;
alter table public.activity_v4
  add constraint activity_v4_clipping_fk foreign key (clipping_id) references public.clippings_v4(id) on delete cascade,
  add constraint activity_v4_user_fk foreign key (user_id) references auth.users(id),
  add constraint activity_v4_note_fk foreign key (note_id) references public.notes_v4(id) on delete set null;
alter table public.exports_v4
  add constraint exports_v4_clipping_fk foreign key (clipping_id) references public.clippings_v4(id) on delete cascade,
  add constraint exports_v4_user_fk foreign key (user_id) references auth.users(id);
alter table public.summaries_v4
  add constraint summaries_v4_clipping_fk foreign key (clipping_id) references public.clippings_v4(id) on delete cascade;
alter table public.user_clipping_state_v4
  add constraint user_clipping_state_v4_user_fk foreign key (user_id) references auth.users(id),
  add constraint user_clipping_state_v4_clipping_fk foreign key (clipping_id) references public.clippings_v4(id) on delete cascade;
alter table public.notes_precarga_v4
  add constraint notes_precarga_v4_client_fk foreign key (client_id) references public.clients(id);
alter table public.reportes_v4
  add constraint reportes_v4_client_fk foreign key (client_id) references public.clients(id),
  add constraint reportes_v4_user_fk foreign key (user_id) references auth.users(id),
  add constraint reportes_v4_clipping_fk foreign key (clipping_id) references public.clippings_v4(id) on delete set null;

-- RLS replica el modelo test: staff ve todo; el resto solo sus clientes.
do $$
declare t text;
begin
  foreach t in array array['clippings_v4','notes_v4','activity_v4','exports_v4',
                           'summaries_v4','user_clipping_state_v4','notes_precarga_v4','reportes_v4']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- El plano v4 nunca es parte de la API anonima. RLS es una segunda
    -- barrera; el permiso SQL se revoca de forma explicita para no depender
    -- de grants heredados o defaults del proyecto.
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create policy clippings_v4_acceso on public.clippings_v4 for all to authenticated
  using (public.is_staff() or public.has_client_access(client_id))
  with check (public.is_staff() or public.has_client_access(client_id));
create policy precarga_v4_acceso on public.notes_precarga_v4 for all to authenticated
  using (public.is_staff() or public.has_client_access(client_id))
  with check (public.is_staff() or public.has_client_access(client_id));
create policy reportes_v4_acceso on public.reportes_v4 for all to authenticated
  using (public.is_staff() or public.has_client_access(client_id))
  with check (public.is_staff() or public.has_client_access(client_id));
create policy notes_v4_acceso on public.notes_v4 for all to authenticated
  using (exists (select 1 from public.clippings_v4 c where c.id = clipping_id))
  with check (exists (select 1 from public.clippings_v4 c where c.id = clipping_id));
create policy activity_v4_acceso on public.activity_v4 for all to authenticated
  using (clipping_id is null or exists (select 1 from public.clippings_v4 c where c.id = clipping_id))
  with check (clipping_id is null or exists (select 1 from public.clippings_v4 c where c.id = clipping_id));
create policy exports_v4_acceso on public.exports_v4 for all to authenticated
  using (exists (select 1 from public.clippings_v4 c where c.id = clipping_id))
  with check (exists (select 1 from public.clippings_v4 c where c.id = clipping_id));
create policy summaries_v4_acceso on public.summaries_v4 for all to authenticated
  using (exists (select 1 from public.clippings_v4 c where c.id = clipping_id))
  with check (exists (select 1 from public.clippings_v4 c where c.id = clipping_id));
create policy ucs_v4_acceso on public.user_clipping_state_v4 for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- El importador es unico: se amplian sus destinos permitidos, sin cambiar su
-- contrato ni las escrituras existentes de test. `public_v4` se resuelve a
-- schema public, donde solo existen las tablas *_v4 recien creadas.
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
      nullif(n.value->>'tier','')::int tier, nullif(n.value->>'alcance','')::bigint alcance,
      nullif(n.value->>'ad_value','')::bigint ad_value, nullif(n.value->>'confianza','')::numeric confianza,
      coalesce((n.value->>'forzada')::boolean,false) forzada, n.value->>'motivo_forzada' motivo_forzada,
      public.url_canonica(n.value->>'url') url_canon
    from jsonb_array_elements(p_clipping->'secciones') with ordinality s(value,ord)
    cross join lateral jsonb_array_elements(coalesce(s.value->'notas','[]'::jsonb)) with ordinality n(value,ord)
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
    select $1,p.seccion,p.medio,p.titulo,p.snippet,p.url,p.pub_date,p.ad_value,$2 + row_number() over(order by p.orden,p.created_at),true,'cliente',p.tier,p.alcance
    from %I.notes_precarga_v4 p where p.client_id=$3 and p.fecha=$4 and p.consumed_at is null$q$,v_schema,v_schema) using v_clip,v_n8n,v_client_id,v_fecha;
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

-- Constructor operativo: obtiene el mismo clipping que hoy arma v4 en prod,
-- lo guarda en public_*_v4 y devuelve el id. No envia mail.
create or replace function public.v4_public_guardar_clipping(p_client_id uuid, p_fecha date default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_clip jsonb;
begin
  v_clip := public.armar_clipping(p_client_id, p_fecha, 'prod');
  return public.import_clipping_v4(v_clip, null, 'public_v4');
end;
$fn$;
revoke all on function public.v4_public_guardar_clipping(uuid,date) from public, anon, authenticated;
grant execute on function public.v4_public_guardar_clipping(uuid,date) to service_role;

-- El mail y la herramienta deben leer la misma foto ya importada. Esta funcion
-- conserva el contrato del lector test, pero resuelve sus tablas por destino.
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
    raise exception 'destino no permitido: %', p_destino using errcode = 'invalid_parameter_value';
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
      select count(*) n, coalesce(sum(n2.ad_value),0) ad,
             count(*) filter(where n2.ad_value is null) sv,
             count(*) filter(where n2.forzada) fz
      from %I.notes_v4 n2 where n2.clipping_id=c.id and n2.incluida
    ) tot on true
    left join lateral (
      select jsonb_agg(x.obj order by x.orden_seccion) arr from (
        select min(n3.orden) orden_seccion,
          jsonb_build_object(
            'nombre',coalesce(n3.seccion,'(sin seccion)'),
            'orden',row_number() over(order by min(n3.orden)),
            'es_exclusiva',coalesce(bool_or(s.es_exclusiva),false),
            'muestra_ad_value',coalesce(bool_or(s.muestra_ad_value),false),
            'cantidad',count(*),'ad_value',coalesce(sum(n3.ad_value),0),
            'sin_valorizar',count(*) filter(where n3.ad_value is null),
            'notas',jsonb_agg(jsonb_build_object(
              'candidata_id',n3.candidata_id,'titulo',n3.titulo,'snippet',n3.snippet,
              'url',n3.url,'medio',n3.medio,'dominio',n3.dominio,'fecha_pub',n3.pub_date,
              'fecha_confiable',n3.fecha_confiable,'tier',n3.tier,'alcance',n3.alcance,
              'ad_value',n3.ad_value,'confianza',n3.confianza,'forzada',n3.forzada,
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

-- Verificacion manual, antes de aplicar en remoto:
-- 1) ninguna FK public.*_v4 apunta a public.clippings/public.notes ni a test.*
-- 2) anon no puede leer ninguna tabla *_v4
-- 3) import_clipping_v4(...,'test') conserva su resultado actual
-- 4) v4_public_guardar_clipping() no modifica public.clippings/public.notes
