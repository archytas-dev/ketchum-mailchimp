-- "Casi entraron · último filtro" mostraba las 12 notas como "Nota sin título /
-- medio sin identificar" en la cuenta de Fedra, y bien en una cuenta staff.
--
-- Causa: la proyección pública guardaba sólo candidata_id, y la pantalla resolvía
-- el título contra public.candidatas_raw, que tiene RLS `using (is_staff())`.
-- Un usuario cliente recibía 0 filas, sin error: la pantalla caía al texto por
-- defecto. El join en SQL siempre existió (las 12 matchean), lo que faltaba era
-- permiso de lectura.
--
-- El arreglo va en la proyección, no en la RLS de candidatas_raw: esa tabla es
-- compartida por todos los clientes (547k filas) y abrirla sería desproporcionado.
-- La foto pública ya se define como autocontenida; acá se la hace cumplir.

alter table public.v4_candidatas_traza_public
  add column if not exists titulo text,
  add column if not exists url text,
  add column if not exists dominio_norm text;

-- Backfill de lo ya proyectado, para que las corridas de hoy se vean bien sin
-- tener que volver a guardar el clipping.
update public.v4_candidatas_traza_public t
   set titulo = c.titulo,
       url = c.url,
       dominio_norm = c.dominio_norm
  from public.candidatas_raw c
 where c.id = t.candidata_id
   and t.titulo is null
   and t.url is null
   and t.dominio_norm is null;

-- Misma función que antes; el único cambio es que la traza se proyecta con la
-- nota resuelta. El left join deja pasar una candidata sin fila en raw en vez de
-- perder la traza entera.
create or replace function public.v4_snapshot_operacion_public(p_run_id uuid, p_clipping_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    (run_id,candidata_id,etapa,resultado,motivo,detalle,created_at,updated_at,
     titulo,url,dominio_norm)
  select t.run_id,t.candidata_id,t.etapa,t.resultado,t.motivo,t.detalle,t.created_at,t.updated_at,
         c.titulo,c.url,c.dominio_norm
    from test.v4_candidatas_traza t
    left join public.candidatas_raw c on c.id = t.candidata_id
   where t.run_id=p_run_id;

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
$function$;
