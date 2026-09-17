-- [W0.22] Foto operativa para la herramienta public_v4.
--
-- n8n sigue trabajando sobre sus tablas internas de test durante la transicion.
-- Al guardar un clipping en public_v4 se copia solo el resumen editorial que
-- necesita la UI: corrida, cobertura, keywords, trazas y recuperaciones.
-- Ninguna tabla de esta migracion referencia tablas legacy ni tablas test.

create table if not exists public.v4_pipeline_runs_public
  (like test.v4_pipeline_runs including all);
create table if not exists public.v4_candidatas_traza_public
  (like test.v4_candidatas_traza including all);
create table if not exists public.v4_run_medios_public
  (like test.v4_run_medios including all);
create table if not exists public.v4_run_keywords_public
  (like test.v4_run_keywords including all);
create table if not exists public.v4_recuperaciones_public
  (like test.v4_recuperaciones including all);

alter table public.v4_pipeline_runs_public
  add constraint v4_pipeline_runs_public_client_fk
  foreign key (client_id) references public.clients(id);
alter table public.v4_candidatas_traza_public
  add constraint v4_candidatas_traza_public_run_fk
  foreign key (run_id) references public.v4_pipeline_runs_public(id) on delete cascade,
  add constraint v4_candidatas_traza_public_candidata_fk
  foreign key (candidata_id) references public.candidatas_raw(id) on delete cascade;
alter table public.v4_run_medios_public
  add constraint v4_run_medios_public_run_fk
  foreign key (run_id) references public.v4_pipeline_runs_public(id) on delete cascade;
alter table public.v4_run_keywords_public
  add constraint v4_run_keywords_public_run_fk
  foreign key (run_id) references public.v4_pipeline_runs_public(id) on delete cascade;
alter table public.v4_recuperaciones_public
  add constraint v4_recuperaciones_public_run_fk
  foreign key (run_id) references public.v4_pipeline_runs_public(id) on delete cascade,
  add constraint v4_recuperaciones_public_candidata_fk
  foreign key (candidata_id) references public.candidatas_raw(id) on delete cascade,
  add constraint v4_recuperaciones_public_clipping_fk
  foreign key (clipping_id) references public.clippings_v4(id) on delete cascade,
  add constraint v4_recuperaciones_public_user_fk
  foreign key (user_id) references auth.users(id);

do $$
declare t text;
begin
  foreach t in array array['v4_pipeline_runs_public','v4_candidatas_traza_public',
                           'v4_run_medios_public','v4_run_keywords_public',
                           'v4_recuperaciones_public']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create policy v4_pipeline_runs_public_acceso on public.v4_pipeline_runs_public
  for select to authenticated
  using (public.is_staff() or public.has_client_access(client_id));
create policy v4_candidatas_traza_public_acceso on public.v4_candidatas_traza_public
  for select to authenticated
  using (exists (select 1 from public.v4_pipeline_runs_public r
                where r.id=run_id and (public.is_staff() or public.has_client_access(r.client_id))));
create policy v4_run_medios_public_acceso on public.v4_run_medios_public
  for select to authenticated
  using (exists (select 1 from public.v4_pipeline_runs_public r
                where r.id=run_id and (public.is_staff() or public.has_client_access(r.client_id))));
create policy v4_run_keywords_public_acceso on public.v4_run_keywords_public
  for select to authenticated
  using (exists (select 1 from public.v4_pipeline_runs_public r
                where r.id=run_id and (public.is_staff() or public.has_client_access(r.client_id))));
create policy v4_recuperaciones_public_acceso on public.v4_recuperaciones_public
  for select to authenticated
  using (exists (select 1 from public.v4_pipeline_runs_public r
                where r.id=run_id and (public.is_staff() or public.has_client_access(r.client_id))));

-- Llamada solamente desde el importador con service_role. La UI lee la foto
-- resultante; nunca consulta el schema test.
create or replace function public.v4_snapshot_operacion_public(
  p_run_id uuid,
  p_clipping_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.v4_pipeline_runs_public
    (id,client_id,fecha,trigger,arranco_at,termino_at,nivel_salida,estado,detalle,
     pool_materializado_at,pool_total,pool_es_muestra,next_orden,next_pagina,
     pagina_activa,pagina_lease_until)
  select id,client_id,fecha,trigger,arranco_at,termino_at,nivel_salida,estado,detalle,
         pool_materializado_at,pool_total,pool_es_muestra,next_orden,next_pagina,
         pagina_activa,pagina_lease_until
    from test.v4_pipeline_runs where id=p_run_id
  on conflict (id) do update set
    client_id=excluded.client_id, fecha=excluded.fecha, trigger=excluded.trigger,
    arranco_at=excluded.arranco_at, termino_at=excluded.termino_at,
    nivel_salida=excluded.nivel_salida, estado=excluded.estado, detalle=excluded.detalle,
    pool_materializado_at=excluded.pool_materializado_at, pool_total=excluded.pool_total,
    pool_es_muestra=excluded.pool_es_muestra, next_orden=excluded.next_orden,
    next_pagina=excluded.next_pagina, pagina_activa=excluded.pagina_activa,
    pagina_lease_until=excluded.pagina_lease_until;

  if not found then
    raise exception 'corrida v4 interna inexistente: %', p_run_id using errcode='no_data_found';
  end if;

  delete from public.v4_candidatas_traza_public where run_id=p_run_id;
  insert into public.v4_candidatas_traza_public
    (run_id,candidata_id,etapa,resultado,motivo,detalle,created_at,updated_at)
  select run_id,candidata_id,etapa,resultado,motivo,detalle,created_at,updated_at
    from test.v4_candidatas_traza where run_id=p_run_id;

  delete from public.v4_run_medios_public where run_id=p_run_id;
  insert into public.v4_run_medios_public
    (run_id,fuente_id,dominio_norm,ok,outcome,http_status,diagnostico,articulos,ms,fetched_at)
  select run_id,fuente_id,dominio_norm,ok,outcome,http_status,diagnostico,articulos,ms,fetched_at
    from test.v4_run_medios where run_id=p_run_id;

  delete from public.v4_run_keywords_public where run_id=p_run_id;
  insert into public.v4_run_keywords_public (run_id,keyword,grupo,activa,matches)
  select run_id,keyword,grupo,activa,matches from test.v4_run_keywords where run_id=p_run_id;

  delete from public.v4_recuperaciones_public where run_id=p_run_id;
  insert into public.v4_recuperaciones_public
    (run_id,candidata_id,clipping_id,user_id,created_at)
  select run_id,candidata_id,p_clipping_id,user_id,created_at
    from test.v4_recuperaciones where run_id=p_run_id;
end;
$fn$;
revoke all on function public.v4_snapshot_operacion_public(uuid,uuid) from public, anon, authenticated;
grant execute on function public.v4_snapshot_operacion_public(uuid,uuid) to service_role;

-- Punto de entrada de la operaciÃ³n v4: recibe el run exacto, arma la misma
-- foto editorial que test y persiste entrega + actividad antes de enviar mail.
create or replace function public.v4_public_guardar_clipping_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_payload jsonb;
  v_result jsonb;
  v_nivel int;
  v_motivo text;
  v_clipping_id uuid;
begin
  v_payload := public.v4_test_armar_clipping(p_run_id);
  if v_payload is null or coalesce(jsonb_typeof(v_payload->'secciones'), '(ausente)') <> 'array' then
    raise exception 'v4_test_armar_clipping no devolvio un clipping usable para run %', p_run_id
      using errcode='no_data_found';
  end if;

  select nivel_salida, detalle->>'motivo'
    into v_nivel, v_motivo
    from test.v4_pipeline_runs where id=p_run_id;
  if not found then
    raise exception 'corrida v4 interna inexistente: %', p_run_id using errcode='no_data_found';
  end if;

  v_payload := v_payload || jsonb_build_object(
    'run_id', p_run_id, 'nivel_salida', v_nivel, 'nivel_motivo', v_motivo
  );
  v_result := public.import_clipping_v4(v_payload, p_run_id::text, 'public_v4');
  v_clipping_id := (v_result->>'clipping_id')::uuid;
  perform public.v4_snapshot_operacion_public(p_run_id, v_clipping_id);
  return v_result || jsonb_build_object('run_id',p_run_id);
end;
$fn$;
revoke all on function public.v4_public_guardar_clipping_run(uuid) from public, anon, authenticated;
grant execute on function public.v4_public_guardar_clipping_run(uuid) to service_role;
