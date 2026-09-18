-- [Z.4] Snapshot completo del pool por corrida.
--
-- La funcion v4_candidatas_del_dia sigue siendo util para inspeccion y
-- pruebas rapidas, pero tiene tope 200. El armado completo necesita una lista
-- estable: el recolector puede seguir insertando notas mientras A1/A2 trabajan
-- y un OFFSET contra candidatas_raw cambiaria el conjunto entre paginas.
--
-- Se materializa una vez el resultado completo del evaluador determinista y
-- despues n8n lee paginas baratas contra este snapshot. El LLM no vuelve a
-- ejecutar regex SQL ni a recorrer el pool completo por cada pagina.

create table if not exists public.pipeline_run_candidatas (
  run_id       uuid not null references public.pipeline_runs(id) on delete cascade,
  candidata_id uuid not null references public.candidatas_raw(id) on delete cascade,
  orden        bigint not null,
  es_prioritaria boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (run_id, candidata_id),
  unique (run_id, orden)
);

create index if not exists pipeline_run_candidatas_run_orden_idx
  on public.pipeline_run_candidatas (run_id, orden);

alter table public.pipeline_runs
  add column if not exists pool_materializado_at timestamptz;
alter table public.pipeline_runs
  add column if not exists pool_total bigint;
alter table public.pipeline_runs
  add column if not exists pool_es_muestra boolean not null default false;

alter table public.pipeline_run_candidatas enable row level security;

comment on table public.pipeline_run_candidatas is
  'Snapshot estable de las candidatas aceptadas por el evaluador para una corrida v4. Se pagina por orden, no contra el pool vivo.';

drop function if exists public.v4_materializar_candidatas(uuid);

create or replace function public.v4_materializar_candidatas(
  p_run_id uuid,
  p_tope int default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout = '120s'
as $function$
declare
  v_run pipeline_runs%rowtype;
  v_nuevas integer := 0;
  v_total bigint := 0;
begin
  select * into v_run
  from pipeline_runs
  where id = p_run_id;

  if not found then
    raise exception 'pipeline_run no existe: %', p_run_id
      using errcode = '22023';
  end if;

  -- La primera llamada construye el snapshot. Una reentrada no lo reemplaza:
  -- reusar una corrida debe reusar exactamente las mismas candidatas.
  if v_run.pool_materializado_at is null then
    insert into pipeline_run_candidatas (run_id, candidata_id, orden, es_prioritaria)
    select
      p_run_id,
      pool.candidata_id,
      pool.orden,
      pool.es_prioritaria
    from (
      select
        e.candidata_id,
        e.es_prioritaria,
        row_number() over (
          order by e.es_prioritaria desc, e.fecha_pub desc nulls last, e.candidata_id
        ) as orden
      from v4_evaluar_candidatas(v_run.client_id, v_run.fecha) e
      where e.descartada_por is null
    ) pool
    where p_tope is null or pool.orden <= greatest(1, p_tope)
    on conflict do nothing;

    get diagnostics v_nuevas = row_count;

    select count(*) into v_total
    from pipeline_run_candidatas
    where run_id = p_run_id;

    update pipeline_runs
       set pool_materializado_at = now(),
           pool_total = v_total,
           pool_es_muestra = p_tope is not null
     where id = p_run_id;
  else
    v_nuevas := 0;
  end if;

  select coalesce(pool_total, 0) into v_total
  from pipeline_runs
  where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'client_id', v_run.client_id,
    'fecha', v_run.fecha,
    'modo', v_run.modo,
    'candidatas_nuevas', v_nuevas,
    'candidatas', v_total,
    'candidatas_es_muestra', false
  );
end;
$function$;

comment on function public.v4_materializar_candidatas(uuid, int) is
  'Construye una sola vez el snapshot del pool para una corrida. Tiene timeout interno de 120 s; p_tope solo se usa en pruebas controladas y NULL materializa todo el pool.';

create or replace function public.v4_candidatas_del_lote(
  p_run_id uuid,
  p_desde_orden bigint default 0,
  p_limite int default 200
)
returns table (
  orden bigint,
  total_candidatas bigint,
  candidata_id uuid,
  titulo text,
  snippet text,
  url text,
  dominio_norm text,
  fecha_pub timestamptz,
  fecha_confiable boolean,
  es_prioritaria boolean,
  transporte text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with pagina as (
    select
      pc.orden,
      count(*) over () as total_candidatas,
      c.id as candidata_id,
      c.titulo,
      c.snippet,
      c.url,
      c.dominio_norm,
      c.fecha_pub,
      c.fecha_confiable,
      pc.es_prioritaria,
      coalesce(me.transporte, 'directo') as transporte
    from pipeline_run_candidatas pc
    join pipeline_runs pr on pr.id = pc.run_id
    join candidatas_raw c on c.id = pc.candidata_id
    left join medios_estrategia me on me.dominio_norm = c.dominio_norm
    where pc.run_id = p_run_id
      and pc.orden > greatest(0, coalesce(p_desde_orden, 0))
    order by pc.orden
    limit greatest(1, least(coalesce(p_limite, 200), 200))
  )
  select * from pagina;
$function$;

comment on function public.v4_candidatas_del_lote(uuid, bigint, int) is
  'Lee una pagina estable de la lista materializada de una corrida. p_desde_orden es cursor monotono; el tope por llamada es 200.';

create or replace function public.decidir_nivel(
  p_client_id uuid,
  p_fecha date default null,
  p_modo text default 'prod'
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with param as (
  select
    coalesce(p_fecha, v4_hoy()) as fecha,
    case when p_modo = 'test' then 'test' else 'prod' end as modo
),
a as (
  select auditar_clipping(
    p_client_id, (select fecha from param), (select modo from param)) as j
),
v as (
  select count(*) filter (where entra) as entran,
         count(*) as juzgadas,
         count(*) filter (where forzada) as forzadas
  from candidatas_veredicto
  where client_id = p_client_id
    and fecha = (select fecha from param)
    and modo = (select modo from param)
),
run as (
  select id, pool_materializado_at, pool_total, pool_es_muestra
  from pipeline_runs
  where client_id = p_client_id
    and fecha = (select fecha from param)
    and modo = (select modo from param)
  order by arranco_at desc
  limit 1
),
p as (
  select
    case when (select pool_materializado_at from run) is not null
      then coalesce((select pool_total from run), 0)
      else coalesce((
        select count(*) from v4_candidatas_del_dia(
          p_client_id, (select fecha from param), 200)
      ), 0)
    end as candidatas,
    coalesce((select pool_materializado_at from run), null) is not null as snapshot
)
select jsonb_build_object(
  'client_id', p_client_id,
  'fecha', (select fecha from param),
  'modo', (select modo from param),
  'nivel', case
    when (select candidatas from p) = 0 then 3
    when (select juzgadas from v) = 0 then 2
    when (select juzgadas from v) < (select candidatas from p) then 1
    when (select entran from v) = 0 then 1
    else 0
  end,
  'motivo', case
    when (select candidatas from p) = 0
      then 'sin candidatas: el pool no dio nada para este cliente'
    when (select juzgadas from v) = 0
      then 'sin veredictos: el A2 no corrio o fallo entero'
    when (select juzgadas from v) < (select candidatas from p)
      then 'el juez no termino de juzgar todo el pool'
    when (select entran from v) = 0
      then 'el juez no dejo pasar ninguna'
    else 'completo'
  end,
  'candidatas', (select candidatas from p),
  'candidatas_es_muestra',
    case when (select snapshot from p)
      then coalesce((select pool_es_muestra from run), false)
      else true
    end,
  'candidatas_tope',
    case when (select snapshot from p) and not coalesce((select pool_es_muestra from run), false)
      then null else 200 end,
  'juzgadas', (select juzgadas from v),
  'entran', (select entran from v),
  'forzadas', (select forzadas from v),
  'notas_finales', ((select j from a)->>'notas_finales')::int,
  'avisos', ((select j from a)->'avisos'),
  'sale', true
);
$function$;

comment on function public.decidir_nivel(uuid, date, text) is
  'Nivel 0-3: cuenta el snapshot completo de la corrida cuando existe; solo conserva el tope 200 como fallback historico.';

grant execute on function public.v4_materializar_candidatas(uuid, int)
  to anon, authenticated, service_role;
grant execute on function public.v4_candidatas_del_lote(uuid, bigint, int)
  to anon, authenticated, service_role;
grant execute on function public.decidir_nivel(uuid, date, text)
  to anon, authenticated, service_role;

