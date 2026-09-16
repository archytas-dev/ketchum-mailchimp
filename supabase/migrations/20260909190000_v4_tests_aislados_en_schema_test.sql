-- v4: las pruebas no comparten ningun estado escribible con produccion.
--
-- Un test puede leer el pool, reglas e historial publicos para representar el
-- resultado real, pero sus snapshots, paginas y veredictos viven enteramente
-- en `test`. Asi una prueba no marca candidatas, no consume el pool y no puede
-- alterar un clipping que vaya a recibir un cliente.

create schema if not exists test;

create table if not exists test.v4_pipeline_runs (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  fecha                 date not null,
  trigger               text,
  arranco_at            timestamptz not null default now(),
  termino_at            timestamptz,
  nivel_salida          int check (nivel_salida between 0 and 3),
  estado                text not null default 'corriendo'
                          check (estado in ('corriendo', 'ok', 'degradado', 'error')),
  detalle               jsonb,
  pool_materializado_at timestamptz,
  pool_total            bigint,
  pool_es_muestra       boolean not null default false,
  next_orden            bigint not null default 0,
  next_pagina           integer not null default 1,
  pagina_activa         integer,
  pagina_lease_until    timestamptz
);

create index if not exists test_v4_pipeline_runs_cliente_fecha_idx
  on test.v4_pipeline_runs (client_id, fecha, arranco_at desc);

create table if not exists test.v4_pipeline_run_candidatas (
  run_id          uuid not null references test.v4_pipeline_runs(id) on delete cascade,
  candidata_id    uuid not null references public.candidatas_raw(id) on delete cascade,
  orden           bigint not null,
  es_prioritaria  boolean not null default false,
  created_at      timestamptz not null default now(),
  primary key (run_id, candidata_id),
  unique (run_id, orden)
);

create index if not exists test_v4_pipeline_run_candidatas_orden_idx
  on test.v4_pipeline_run_candidatas (run_id, orden);

create table if not exists test.v4_pipeline_run_pages (
  run_id       uuid not null references test.v4_pipeline_runs(id) on delete cascade,
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

create table if not exists test.v4_candidatas_veredicto (
  run_id           uuid not null references test.v4_pipeline_runs(id) on delete cascade,
  candidata_id     uuid not null references public.candidatas_raw(id) on delete cascade,
  entra            boolean not null,
  seccion          text,
  confianza        numeric,
  forzada          boolean not null default false,
  motivo_forzada   text,
  agente           text not null default 'a2',
  created_at       timestamptz not null default now(),
  primary key (run_id, candidata_id)
);

create index if not exists test_v4_veredictos_entran_idx
  on test.v4_candidatas_veredicto (run_id) where entra;

alter table test.v4_pipeline_runs enable row level security;
alter table test.v4_pipeline_run_candidatas enable row level security;
alter table test.v4_pipeline_run_pages enable row level security;
alter table test.v4_candidatas_veredicto enable row level security;

-- Todos los accesos de n8n entran por estas funciones publicas SECURITY
-- DEFINER. No exponemos tablas de test por REST ni damos acceso anon al schema.
create or replace function public.v4_test_abrir_run(
  p_client_id uuid,
  p_fecha date default null,
  p_trigger text default 'manual',
  p_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'test', 'public'
as $function$
declare
  v_run test.v4_pipeline_runs%rowtype;
  v_fecha date := coalesce(p_fecha, public.v4_hoy());
begin
  if p_run_id is not null then
    select * into v_run from test.v4_pipeline_runs
     where id = p_run_id and client_id = p_client_id;
    if not found then
      raise exception 'corrida test inexistente o de otro cliente: %', p_run_id
        using errcode = '22023';
    end if;
    return jsonb_build_object('run_id', v_run.id, 'ya_corrio', false,
      'fecha', v_run.fecha, 'motivo', 'se reanuda la corrida test');
  end if;

  insert into test.v4_pipeline_runs (client_id, fecha, trigger)
  values (p_client_id, v_fecha, p_trigger)
  returning * into v_run;

  return jsonb_build_object('run_id', v_run.id, 'ya_corrio', false,
    'fecha', v_run.fecha, 'motivo', 'corrida test nueva y aislada');
end;
$function$;

create or replace function public.v4_test_materializar_candidatas(
  p_run_id uuid,
  p_tope int default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'test', 'public'
set statement_timeout = '120s'
as $function$
declare
  v_run test.v4_pipeline_runs%rowtype;
  v_nuevas integer := 0;
  v_total bigint := 0;
begin
  select * into v_run from test.v4_pipeline_runs where id = p_run_id for update;
  if not found then raise exception 'corrida test inexistente: %', p_run_id using errcode = '22023'; end if;

  if v_run.pool_materializado_at is null then
    insert into test.v4_pipeline_run_candidatas (run_id, candidata_id, orden, es_prioritaria)
    select p_run_id, x.candidata_id, x.orden, x.es_prioritaria
    from (
      select e.candidata_id, e.es_prioritaria,
             row_number() over (order by e.es_prioritaria desc, e.fecha_pub desc nulls last, e.candidata_id) as orden
      from public.v4_evaluar_candidatas(v_run.client_id, v_run.fecha) e
      where e.descartada_por is null
    ) x
    where p_tope is null or x.orden <= greatest(1, p_tope);

    get diagnostics v_nuevas = row_count;
    select count(*) into v_total from test.v4_pipeline_run_candidatas where run_id = p_run_id;
    update test.v4_pipeline_runs
       set pool_materializado_at = now(), pool_total = v_total, pool_es_muestra = p_tope is not null
     where id = p_run_id;
  else
    select coalesce(pool_total, 0) into v_total from test.v4_pipeline_runs where id = p_run_id;
  end if;

  return jsonb_build_object('run_id', p_run_id, 'client_id', v_run.client_id,
    'fecha', v_run.fecha, 'modo', 'test', 'candidatas_nuevas', v_nuevas,
    'candidatas', v_total, 'candidatas_es_muestra', p_tope is not null);
end;
$function$;

create or replace function public.v4_test_tomar_pagina(
  p_run_id uuid, p_limite integer default 20, p_lease_seconds integer default 1800
)
returns jsonb
language plpgsql
security definer
set search_path to 'test', 'public'
as $function$
declare
  v_run test.v4_pipeline_runs%rowtype;
  v_desde bigint;
  v_hasta bigint;
  v_candidatas integer;
  v_pagina integer;
  v_intento integer;
  v_lease timestamptz;
begin
  select * into v_run from test.v4_pipeline_runs where id = p_run_id for update;
  if not found then raise exception 'corrida test inexistente: %', p_run_id using errcode = '22023'; end if;
  if v_run.pool_materializado_at is null then raise exception 'pool test sin materializar: %', p_run_id using errcode = '55000'; end if;

  if v_run.pagina_activa is not null and v_run.pagina_lease_until > now() then
    return jsonb_build_object('run_id', p_run_id, 'busy', true, 'done', false,
      'pagina', v_run.pagina_activa, 'lease_until', v_run.pagina_lease_until);
  end if;
  if v_run.pagina_activa is not null then
    update test.v4_pipeline_run_pages set estado = 'error', terminado_at = now(), lease_until = null,
      detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('motivo', 'lease vencido; se reintenta la pagina')
    where run_id = p_run_id and pagina = v_run.pagina_activa and estado = 'corriendo';
  end if;

  v_pagina := greatest(1, coalesce(v_run.next_pagina, 1));
  select count(*)::integer, min(q.orden), max(q.orden) into v_candidatas, v_desde, v_hasta
  from (
    select pc.orden from test.v4_pipeline_run_candidatas pc
    where pc.run_id = p_run_id and pc.orden > coalesce(v_run.next_orden, 0)
      and not exists (select 1 from test.v4_candidatas_veredicto cv where cv.run_id = p_run_id and cv.candidata_id = pc.candidata_id)
    order by pc.orden limit greatest(1, least(coalesce(p_limite, 20), 30))
  ) q;
  if coalesce(v_candidatas, 0) = 0 then
    update test.v4_pipeline_runs set pagina_activa = null, pagina_lease_until = null where id = p_run_id;
    return jsonb_build_object('run_id', p_run_id, 'busy', false, 'done', true, 'candidatas', 0,
      'next_orden', coalesce(v_run.next_orden, 0), 'pool_total', coalesce(v_run.pool_total, 0));
  end if;

  select coalesce(intento, 0) + 1 into v_intento from test.v4_pipeline_run_pages where run_id = p_run_id and pagina = v_pagina;
  v_intento := coalesce(v_intento, 1);
  v_lease := now() + make_interval(secs => greatest(300, least(coalesce(p_lease_seconds, 1800), 7200)));
  insert into test.v4_pipeline_run_pages (run_id, pagina, desde_orden, hasta_orden, candidatas, juzgadas, intento, estado, lease_until)
  values (p_run_id, v_pagina, v_desde - 1, v_hasta, v_candidatas, 0, v_intento, 'corriendo', v_lease)
  on conflict (run_id, pagina) do update set desde_orden = excluded.desde_orden, hasta_orden = excluded.hasta_orden,
    candidatas = excluded.candidatas, juzgadas = 0, intento = excluded.intento, estado = 'corriendo',
    iniciado_at = now(), terminado_at = null, lease_until = excluded.lease_until, detalle = null;
  update test.v4_pipeline_runs set pagina_activa = v_pagina, pagina_lease_until = v_lease where id = p_run_id;
  return jsonb_build_object('run_id', p_run_id, 'busy', false, 'done', false, 'pagina', v_pagina,
    'intento', v_intento, 'desde_orden', v_desde - 1, 'hasta_orden', v_hasta,
    'candidatas', v_candidatas, 'pool_total', coalesce(v_run.pool_total, 0), 'lease_until', v_lease);
end;
$function$;

create or replace function public.v4_test_candidatas_del_lote(
  p_run_id uuid, p_desde_orden bigint default 0, p_limite int default 20
)
returns table (
  orden bigint, total_candidatas bigint, candidata_id uuid, titulo text, snippet text, url text,
  dominio_norm text, fecha_pub timestamptz, fecha_confiable boolean, es_prioritaria boolean, transporte text
)
language sql stable security definer set search_path to 'test', 'public'
as $function$
  with pagina as (
    select pc.orden, count(*) over () as total_candidatas, c.id as candidata_id, c.titulo, c.snippet, c.url,
      c.dominio_norm, c.fecha_pub, c.fecha_confiable, pc.es_prioritaria, coalesce(me.transporte, 'directo') as transporte
    from test.v4_pipeline_run_candidatas pc
    join public.candidatas_raw c on c.id = pc.candidata_id
    left join public.medios_estrategia me on me.dominio_norm = c.dominio_norm
    left join test.v4_candidatas_veredicto cv on cv.run_id = pc.run_id and cv.candidata_id = pc.candidata_id
    where pc.run_id = p_run_id and pc.orden > greatest(0, coalesce(p_desde_orden, 0)) and cv.candidata_id is null
    order by pc.orden limit greatest(1, least(coalesce(p_limite, 20), 30))
  ) select * from pagina;
$function$;

create or replace function public.v4_test_guardar_veredictos(p_run_id uuid, p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'test', 'public'
as $function$
declare v_run test.v4_pipeline_runs%rowtype; v_guardadas integer := 0;
begin
  select * into v_run from test.v4_pipeline_runs where id = p_run_id;
  if not found then raise exception 'corrida test inexistente: %', p_run_id using errcode = '22023'; end if;
  insert into test.v4_candidatas_veredicto (run_id, candidata_id, entra, seccion, confianza, forzada, motivo_forzada, agente)
  select p_run_id, x.candidata_id, coalesce(x.entra, false), nullif(x.seccion, ''), x.confianza,
    coalesce(x.forzada, false), x.motivo_forzada, coalesce(nullif(x.agente, ''), 'a2')
  from jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb)) as x(
    candidata_id uuid, entra boolean, seccion text, confianza numeric, forzada boolean, motivo_forzada text, agente text
  )
  join test.v4_pipeline_run_candidatas pc on pc.run_id = p_run_id and pc.candidata_id = x.candidata_id
  on conflict (run_id, candidata_id) do update set entra = excluded.entra, seccion = excluded.seccion,
    confianza = excluded.confianza, forzada = excluded.forzada, motivo_forzada = excluded.motivo_forzada,
    agente = excluded.agente, created_at = now();
  get diagnostics v_guardadas = row_count;
  return jsonb_build_object('run_id', p_run_id, 'guardadas', v_guardadas);
end;
$function$;

create or replace function public.v4_test_terminar_pagina(
  p_run_id uuid, p_pagina integer, p_juzgadas integer default 0, p_estado text default 'ok', p_detalle jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'test', 'public'
as $function$
declare v_page test.v4_pipeline_run_pages%rowtype; v_ok boolean; v_next bigint; v_more boolean;
begin
  select * into v_page from test.v4_pipeline_run_pages where run_id = p_run_id and pagina = p_pagina for update;
  if not found then raise exception 'pagina test inexistente: %', p_pagina using errcode = '22023'; end if;
  v_ok := lower(coalesce(p_estado, 'error')) = 'ok' and coalesce(p_juzgadas, 0) >= v_page.candidatas;
  if v_ok then
    update test.v4_pipeline_run_pages set estado = 'ok', juzgadas = p_juzgadas, terminado_at = now(), lease_until = null, detalle = p_detalle
     where run_id = p_run_id and pagina = p_pagina;
    update test.v4_pipeline_runs set next_orden = greatest(next_orden, v_page.hasta_orden), next_pagina = greatest(next_pagina, p_pagina + 1),
      pagina_activa = null, pagina_lease_until = null where id = p_run_id;
  else
    update test.v4_pipeline_run_pages set estado = 'error', juzgadas = coalesce(p_juzgadas, 0), terminado_at = now(), lease_until = null,
      detalle = coalesce(p_detalle, '{}'::jsonb) || jsonb_build_object('motivo', 'la pagina no produjo un veredicto por candidata')
     where run_id = p_run_id and pagina = p_pagina;
    update test.v4_pipeline_runs set pagina_activa = null, pagina_lease_until = null, estado = 'degradado', termino_at = now() where id = p_run_id;
  end if;
  select next_orden into v_next from test.v4_pipeline_runs where id = p_run_id;
  select exists (select 1 from test.v4_pipeline_run_candidatas pc
    where pc.run_id = p_run_id and pc.orden > coalesce(v_next, 0)
      and not exists (select 1 from test.v4_candidatas_veredicto cv where cv.run_id = p_run_id and cv.candidata_id = pc.candidata_id)) into v_more;
  return jsonb_build_object('run_id', p_run_id, 'pagina', p_pagina, 'estado_pagina', case when v_ok then 'ok' else 'error' end,
    'juzgadas', coalesce(p_juzgadas, 0), 'has_more', case when v_ok then v_more else true end, 'reintentar', not v_ok);
end;
$function$;

create or replace function public.v4_test_armar_clipping(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path to 'test', 'public'
as $function$
with run as (select * from test.v4_pipeline_runs where id = p_run_id),
notas as (
  select v.candidata_id, v.seccion, v.confianza, v.forzada, c.titulo, c.snippet, c.url, c.dominio_norm, c.fecha_pub, c.fecha_confiable,
    coalesce(t.ad_value, td.ad_value) as ad_value, t.tier, t.alcance, coalesce(t.medio, c.dominio_norm) as medio
  from test.v4_candidatas_veredicto v
  join run r on r.id = v.run_id
  join public.candidatas_raw c on c.id = v.candidata_id
  left join public.tiers t on t.client_id = r.client_id and lower(t.dominio) = lower(c.dominio_norm)
  left join public.tier_defaults td on td.client_id = r.client_id and td.tier = t.tier
  where v.run_id = p_run_id and v.entra
), por_seccion as (
  select s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value,
    coalesce(jsonb_agg(jsonb_build_object('candidata_id', n.candidata_id, 'titulo', n.titulo, 'snippet', n.snippet,
      'url', n.url, 'medio', n.medio, 'dominio', n.dominio_norm, 'fecha_pub', n.fecha_pub,
      'fecha_confiable', n.fecha_confiable, 'tier', n.tier, 'alcance', n.alcance, 'ad_value', n.ad_value,
      'confianza', n.confianza, 'forzada', n.forzada) order by n.ad_value desc nulls last, n.fecha_pub desc nulls last, n.titulo)
      filter (where n.candidata_id is not null), '[]'::jsonb) as notas,
    count(n.candidata_id) as cantidad, coalesce(sum(n.ad_value), 0) as ad_value_seccion,
    count(*) filter (where n.ad_value is null and n.candidata_id is not null) as sin_valorizar
  from public.secciones s join run r on r.client_id = s.client_id left join notas n on n.seccion = s.nombre
  where s.activa group by s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value
)
select jsonb_build_object('run_id', p_run_id, 'client_id', (select client_id from run), 'fecha', (select fecha from run), 'modo', 'test',
  'total_notas', (select count(*) from notas), 'ad_value_total', (select coalesce(sum(ad_value), 0) from notas),
  'sin_valorizar', (select count(*) from notas where ad_value is null), 'forzadas', (select count(*) from notas where forzada),
  'secciones', coalesce((select jsonb_agg(jsonb_build_object('nombre', ps.nombre, 'orden', ps.orden,
    'es_exclusiva', ps.es_exclusiva, 'muestra_ad_value', ps.muestra_ad_value, 'cantidad', ps.cantidad,
    'ad_value', ps.ad_value_seccion, 'sin_valorizar', ps.sin_valorizar, 'notas', ps.notas) order by ps.orden) from por_seccion ps), '[]'::jsonb));
$function$;

create or replace function public.v4_test_decidir_nivel(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path to 'test', 'public'
as $function$
with r as (select * from test.v4_pipeline_runs where id = p_run_id),
v as (select count(*) as juzgadas, count(*) filter (where entra) as entran, count(*) filter (where forzada) as forzadas from test.v4_candidatas_veredicto where run_id = p_run_id),
c as (select public.v4_test_armar_clipping(p_run_id) as j)
select jsonb_build_object('run_id', p_run_id, 'client_id', (select client_id from r), 'fecha', (select fecha from r), 'modo', 'test',
  'nivel', case when coalesce((select pool_total from r), 0) = 0 then 3 when (select juzgadas from v) = 0 then 2
    when (select juzgadas from v) < coalesce((select pool_total from r), 0) then 1 when (select entran from v) = 0 then 1 else 0 end,
  'motivo', case when coalesce((select pool_total from r), 0) = 0 then 'sin candidatas: el pool no dio nada para este cliente'
    when (select juzgadas from v) = 0 then 'sin veredictos: el A2 no corrio o fallo entero'
    when (select juzgadas from v) < coalesce((select pool_total from r), 0) then 'el juez no termino de juzgar todo el pool'
    when (select entran from v) = 0 then 'el juez no dejo pasar ninguna' else 'completo' end,
  'candidatas', coalesce((select pool_total from r), 0), 'candidatas_es_muestra', coalesce((select pool_es_muestra from r), false),
  'candidatas_tope', null, 'juzgadas', (select juzgadas from v), 'entran', (select entran from v), 'forzadas', (select forzadas from v),
  'notas_finales', ((select j from c)->>'total_notas')::int, 'avisos', '[]'::jsonb, 'sale', true);
$function$;

create or replace function public.v4_test_cerrar_run(p_run_id uuid, p_nivel int default null, p_detalle jsonb default null)
returns jsonb
language sql security definer set search_path to 'test', 'public'
as $function$
  update test.v4_pipeline_runs set termino_at = now(), nivel_salida = p_nivel,
    estado = case when coalesce(p_nivel, 3) = 0 then 'ok' else 'degradado' end,
    detalle = coalesce(p_detalle, detalle)
  where id = p_run_id
  returning jsonb_build_object('run_id', id, 'estado', estado, 'nivel', nivel_salida);
$function$;

grant execute on function public.v4_test_abrir_run(uuid, date, text, uuid) to anon, authenticated, service_role;
grant execute on function public.v4_test_materializar_candidatas(uuid, int) to anon, authenticated, service_role;
grant execute on function public.v4_test_tomar_pagina(uuid, integer, integer) to anon, authenticated, service_role;
grant execute on function public.v4_test_candidatas_del_lote(uuid, bigint, int) to anon, authenticated, service_role;
grant execute on function public.v4_test_guardar_veredictos(uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.v4_test_terminar_pagina(uuid, integer, integer, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.v4_test_armar_clipping(uuid) to anon, authenticated, service_role;
grant execute on function public.v4_test_decidir_nivel(uuid) to anon, authenticated, service_role;
grant execute on function public.v4_test_cerrar_run(uuid, int, jsonb) to anon, authenticated, service_role;

comment on schema test is 'Datos de pruebas: nunca se usan para enviar ni marcar contenido de clientes.';
