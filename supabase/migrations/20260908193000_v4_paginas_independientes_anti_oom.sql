-- [Z.5] Procesamiento por pagina y ejecucion independiente.
--
-- Una corrida completa no puede retener miles de items dentro de un loop de
-- n8n: cada vuelta conserva parte del historial y termina agotando el heap.
-- La base pasa a ser el cursor/lease. Cada ejecucion de n8n reclama una sola
-- pagina, la procesa y dispara la siguiente por webhook asincrono.

create table if not exists public.pipeline_run_pages (
  run_id       uuid not null references public.pipeline_runs(id) on delete cascade,
  pagina       integer not null,
  desde_orden  bigint not null,
  hasta_orden  bigint not null,
  candidatas   integer not null default 0,
  juzgadas     integer not null default 0,
  intento      integer not null default 1,
  estado       text not null default 'corriendo'
    check (estado in ('corriendo', 'ok', 'error')),
  iniciado_at  timestamptz not null default now(),
  terminado_at timestamptz,
  lease_until  timestamptz,
  detalle      jsonb,
  primary key (run_id, pagina)
);

create index if not exists pipeline_run_pages_run_estado_idx
  on public.pipeline_run_pages (run_id, estado, pagina);

alter table public.pipeline_runs
  add column if not exists next_orden bigint not null default 0;
alter table public.pipeline_runs
  add column if not exists next_pagina integer not null default 1;
alter table public.pipeline_runs
  add column if not exists pagina_activa integer;
alter table public.pipeline_runs
  add column if not exists pagina_lease_until timestamptz;

alter table public.pipeline_run_pages enable row level security;

comment on table public.pipeline_run_pages is
  'Lease y resultado de cada pagina independiente de una corrida v4. Evita que n8n acumule el historial de todo el pool.';

create or replace function public.v4_abrir_run(
  p_client_id uuid,
  p_modo text default 'test',
  p_fecha date default null,
  p_trigger text default 'manual',
  p_rehacer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fecha date := coalesce(p_fecha, v4_hoy());
  v_modo text := case when p_modo = 'prod' then 'prod' else 'test' end;
  v_run pipeline_runs%rowtype;
begin
  select * into v_run
  from pipeline_runs
  where client_id = p_client_id
    and fecha = v_fecha
    and modo = v_modo;

  if found then
    if p_rehacer then
      delete from candidatas_veredicto
      where client_id = p_client_id
        and fecha = v_fecha
        and modo = v_modo;

      delete from pipeline_run_candidatas
      where run_id = v_run.id;

      delete from pipeline_run_pages
      where run_id = v_run.id;

      update pipeline_runs
         set estado = 'corriendo',
             arranco_at = now(),
             termino_at = null,
             nivel_salida = null,
             detalle = null,
             pool_materializado_at = null,
             pool_total = null,
             pool_es_muestra = false,
             next_orden = 0,
             next_pagina = 1,
             pagina_activa = null,
             pagina_lease_until = null,
             trigger = p_trigger
       where id = v_run.id;

      return jsonb_build_object(
        'run_id', v_run.id,
        'ya_corrio', false,
        'fecha', v_fecha,
        'motivo', 'se fuerza una nueva corrida y se limpia el resultado anterior'
      );
    end if;

    if v_run.estado = 'ok' then
      return jsonb_build_object(
        'run_id', v_run.id,
        'ya_corrio', true,
        'estado', v_run.estado,
        'nivel', v_run.nivel_salida,
        'fecha', v_fecha,
        'motivo', 'ya hay una corrida terminada para este cliente y dia'
      );
    end if;

    update pipeline_runs
       set estado = 'corriendo',
           arranco_at = now(),
           termino_at = null,
           trigger = p_trigger
     where id = v_run.id;

    return jsonb_build_object(
      'run_id', v_run.id,
      'ya_corrio', false,
      'fecha', v_fecha,
      'motivo', case when v_run.estado = 'degradado'
        then 'se reanuda una corrida degradada y se procesan solo pendientes'
        else 'se reusa una corrida previa que no habia terminado' end
    );
  end if;

  insert into pipeline_runs (client_id, fecha, modo, trigger, arranco_at, estado)
  values (p_client_id, v_fecha, v_modo, p_trigger, now(), 'corriendo')
  returning * into v_run;

  return jsonb_build_object(
    'run_id', v_run.id,
    'ya_corrio', false,
    'fecha', v_fecha,
    'motivo', 'corrida nueva'
  );
end;
$function$;

comment on function public.v4_abrir_run(uuid, text, date, text, boolean) is
  'Abre o reanuda una corrida v4 y reinicia el cursor/leases al rehacerla.';

grant execute on function public.v4_abrir_run(uuid, text, date, text, boolean)
  to anon, authenticated, service_role;

create or replace function public.v4_tomar_pagina(
  p_run_id uuid,
  p_limite integer default 200,
  p_lease_seconds integer default 1800
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_run pipeline_runs%rowtype;
  v_desde bigint;
  v_hasta bigint;
  v_candidatas integer;
  v_pagina integer;
  v_intento integer;
  v_lease timestamptz;
begin
  select * into v_run
  from pipeline_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'pipeline_run no existe: %', p_run_id
      using errcode = '22023';
  end if;

  if v_run.pool_materializado_at is null then
    raise exception 'el pool todavía no está materializado para la corrida %', p_run_id
      using errcode = '55000';
  end if;

  -- Un webhook duplicado no debe reclamar la pagina que otra ejecucion está
  -- procesando. El lease expira si n8n muere y permite reintentarla.
  if v_run.pagina_activa is not null
     and v_run.pagina_lease_until is not null
     and v_run.pagina_lease_until > now() then
    return jsonb_build_object(
      'run_id', p_run_id,
      'busy', true,
      'done', false,
      'pagina', v_run.pagina_activa,
      'lease_until', v_run.pagina_lease_until
    );
  end if;

  if v_run.pagina_activa is not null then
    update pipeline_run_pages
       set estado = 'error',
           terminado_at = now(),
           lease_until = null,
           detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
             'motivo', 'lease vencido; se reintenta la pagina'
           )
     where run_id = p_run_id
       and pagina = v_run.pagina_activa
       and estado = 'corriendo';
  end if;

  v_desde := greatest(0, coalesce(v_run.next_orden, 0));
  v_pagina := greatest(1, coalesce(v_run.next_pagina, 1));

  select count(*)::integer, min(x.orden), max(x.orden)
    into v_candidatas, v_desde, v_hasta
  from (
    select pc.orden
    from pipeline_run_candidatas pc
    join candidatas_raw c on c.id = pc.candidata_id
    where pc.run_id = p_run_id
      and pc.orden > greatest(0, coalesce(v_run.next_orden, 0))
      and not exists (
        select 1
        from candidatas_veredicto cv
        where cv.client_id = v_run.client_id
          and cv.fecha = v_run.fecha
          and cv.modo = v_run.modo
          and cv.candidata_id = pc.candidata_id
      )
    order by pc.orden
    limit greatest(1, least(coalesce(p_limite, 200), 200))
  ) x;

  if coalesce(v_candidatas, 0) = 0 then
    update pipeline_runs
       set pagina_activa = null,
           pagina_lease_until = null
     where id = p_run_id;

    return jsonb_build_object(
      'run_id', p_run_id,
      'busy', false,
      'done', true,
      'candidatas', 0,
      'next_orden', coalesce(v_run.next_orden, 0),
      'pool_total', coalesce(v_run.pool_total, 0)
    );
  end if;

  select coalesce(intento, 0) + 1 into v_intento
  from pipeline_run_pages
  where run_id = p_run_id
    and pagina = v_pagina;

  v_intento := coalesce(v_intento, 1);
  v_lease := now() + make_interval(secs => greatest(300, least(coalesce(p_lease_seconds, 1800), 7200)));

  insert into pipeline_run_pages (
    run_id, pagina, desde_orden, hasta_orden, candidatas,
    juzgadas, intento, estado, iniciado_at, terminado_at, lease_until, detalle
  ) values (
    p_run_id, v_pagina, v_desde - 1, v_hasta, v_candidatas,
    0, v_intento, 'corriendo', now(), null, v_lease, null
  )
  on conflict (run_id, pagina) do update set
    desde_orden = excluded.desde_orden,
    hasta_orden = excluded.hasta_orden,
    candidatas = excluded.candidatas,
    juzgadas = 0,
    intento = excluded.intento,
    estado = 'corriendo',
    iniciado_at = excluded.iniciado_at,
    terminado_at = null,
    lease_until = excluded.lease_until,
    detalle = null;

  update pipeline_runs
     set pagina_activa = v_pagina,
         pagina_lease_until = v_lease
   where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'busy', false,
    'done', false,
    'pagina', v_pagina,
    'intento', v_intento,
    'desde_orden', v_desde - 1,
    'hasta_orden', v_hasta,
    'candidatas', v_candidatas,
    'pool_total', coalesce(v_run.pool_total, 0),
    'lease_until', v_lease
  );
end;
$function$;

comment on function public.v4_tomar_pagina(uuid, integer, integer) is
  'Reclama atómicamente una pagina pendiente de una corrida. Si el lease sigue vivo devuelve busy y no duplica trabajo.';

grant execute on function public.v4_tomar_pagina(uuid, integer, integer)
  to anon, authenticated, service_role;

create or replace function public.v4_terminar_pagina(
  p_run_id uuid,
  p_pagina integer,
  p_juzgadas integer default 0,
  p_estado text default 'ok',
  p_detalle jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_page pipeline_run_pages%rowtype;
  v_ok boolean;
  v_has_more boolean;
  v_next bigint;
begin
  select * into v_page
  from pipeline_run_pages
  where run_id = p_run_id
    and pagina = p_pagina
  for update;

  if not found then
    raise exception 'pagina % no existe para la corrida %', p_pagina, p_run_id
      using errcode = '22023';
  end if;

  if v_page.estado = 'ok' then
    select next_orden into v_next from pipeline_runs where id = p_run_id;
    select exists (
      select 1
      from pipeline_run_candidatas pc
      join pipeline_runs pr on pr.id = pc.run_id
      where pc.run_id = p_run_id
        and pc.orden > coalesce(v_next, 0)
        and not exists (
          select 1 from candidatas_veredicto cv
          where cv.client_id = pr.client_id
            and cv.fecha = pr.fecha
            and cv.modo = pr.modo
            and cv.candidata_id = pc.candidata_id
        )
    ) into v_has_more;

    return jsonb_build_object(
      'run_id', p_run_id,
      'pagina', p_pagina,
      'estado_pagina', 'ok',
      'juzgadas', v_page.juzgadas,
      'has_more', v_has_more,
      'idempotente', true
    );
  end if;

  v_ok := lower(coalesce(p_estado, 'error')) = 'ok'
          and coalesce(p_juzgadas, 0) >= v_page.candidatas;

  if v_ok then
    update pipeline_run_pages
       set estado = 'ok',
           juzgadas = coalesce(p_juzgadas, 0),
           terminado_at = now(),
           lease_until = null,
           detalle = p_detalle
     where run_id = p_run_id
       and pagina = p_pagina;

    update pipeline_runs
       set next_orden = greatest(coalesce(next_orden, 0), v_page.hasta_orden),
           next_pagina = greatest(coalesce(next_pagina, 1), p_pagina + 1),
           pagina_activa = null,
           pagina_lease_until = null
     where id = p_run_id;
  else
    update pipeline_run_pages
       set estado = 'error',
           juzgadas = coalesce(p_juzgadas, 0),
           terminado_at = now(),
           lease_until = null,
           detalle = coalesce(p_detalle, '{}'::jsonb) || jsonb_build_object(
             'motivo', 'la pagina no produjo un veredicto por candidata'
           )
     where run_id = p_run_id
       and pagina = p_pagina;

    update pipeline_runs
       set pagina_activa = null,
           pagina_lease_until = null,
           estado = 'degradado',
           termino_at = now()
     where id = p_run_id;
  end if;

  select next_orden into v_next from pipeline_runs where id = p_run_id;
  select exists (
    select 1
    from pipeline_run_candidatas pc
    join pipeline_runs pr on pr.id = pc.run_id
    where pc.run_id = p_run_id
      and pc.orden > coalesce(v_next, 0)
      and not exists (
        select 1 from candidatas_veredicto cv
        where cv.client_id = pr.client_id
          and cv.fecha = pr.fecha
          and cv.modo = pr.modo
          and cv.candidata_id = pc.candidata_id
      )
  ) into v_has_more;

  return jsonb_build_object(
    'run_id', p_run_id,
    'pagina', p_pagina,
    'estado_pagina', case when v_ok then 'ok' else 'error' end,
    'juzgadas', coalesce(p_juzgadas, 0),
    'has_more', case when v_ok then v_has_more else true end,
    'reintentar', not v_ok
  );
end;
$function$;

comment on function public.v4_terminar_pagina(uuid, integer, integer, text, jsonb) is
  'Confirma una pagina solo si todas sus candidatas tienen veredicto; si no, conserva el cursor y deja la corrida degradada para reintento.';

grant execute on function public.v4_terminar_pagina(uuid, integer, integer, text, jsonb)
  to anon, authenticated, service_role;
