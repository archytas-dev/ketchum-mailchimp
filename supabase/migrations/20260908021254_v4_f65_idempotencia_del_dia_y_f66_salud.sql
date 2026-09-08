-- [F6.5] Idempotencia del dia y [F6.7] donde caen los errores.
--
-- pipeline_runs existia con la forma correcta pero SIN indice unico: nada
-- impedia abrir dos corridas del mismo cliente el mismo dia. La clave
-- (client_id, fecha, modo) estaba en el diseno y no en la base.

-- El vocabulario: todos los workflows de la v4 dicen 'test', el CHECK decia
-- 'ensayo'. Dos palabras para lo mismo es una traduccion silenciosa esperando
-- confundir a alguien. Se unifica en 'test' y 'ensayo' queda como sinonimo
-- historico para no romper lo que ya existe.
alter table public.pipeline_runs drop constraint if exists pipeline_runs_modo_check;
alter table public.pipeline_runs add constraint pipeline_runs_modo_check
  check (modo = any (array['prod'::text, 'test'::text, 'ensayo'::text]));

create unique index if not exists pipeline_runs_dia_uk
  on public.pipeline_runs (client_id, fecha, modo);

-- ---------------------------------------------------------------------------
-- Abrir la corrida del dia. Idempotente: si ya hay una TERMINADA no se vuelve a
-- correr, se devuelve la que hay. Re-ejecutar el mismo dia no duplica el
-- clipping ni manda un segundo mail (mandamiento 6).
-- ---------------------------------------------------------------------------
create or replace function public.v4_abrir_run(
  p_client_id uuid,
  p_modo text default 'test',
  p_fecha date default null,
  p_trigger text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fecha date := coalesce(p_fecha, v4_hoy());
  v_modo  text := case when p_modo = 'prod' then 'prod' else 'test' end;
  v_run   pipeline_runs%rowtype;
begin
  select * into v_run from pipeline_runs
   where client_id = p_client_id and fecha = v_fecha and modo = v_modo;

  if found then
    -- Ya termino: no se rehace. Quien llama decide si le alcanza con lo que hay.
    if v_run.estado in ('ok','degradado') then
      return jsonb_build_object('run_id', v_run.id, 'ya_corrio', true,
        'estado', v_run.estado, 'nivel', v_run.nivel_salida, 'fecha', v_fecha,
        'motivo', 'ya hay una corrida terminada para este cliente y dia');
    end if;
    -- Quedo colgada o fallo: se reusa la misma fila en vez de abrir otra.
    update pipeline_runs
       set estado = 'corriendo', arranco_at = now(), termino_at = null,
           trigger = p_trigger
     where id = v_run.id;
    return jsonb_build_object('run_id', v_run.id, 'ya_corrio', false,
      'fecha', v_fecha, 'motivo', 'se reusa una corrida previa que no habia terminado');
  end if;

  insert into pipeline_runs (client_id, fecha, modo, trigger, arranco_at, estado)
  values (p_client_id, v_fecha, v_modo, p_trigger, now(), 'corriendo')
  returning * into v_run;

  return jsonb_build_object('run_id', v_run.id, 'ya_corrio', false,
    'fecha', v_fecha, 'motivo', 'corrida nueva');
end;
$$;

create or replace function public.v4_cerrar_run(
  p_run_id uuid,
  p_nivel int default null,
  p_detalle jsonb default null
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  update pipeline_runs
     set termino_at = now(),
         nivel_salida = p_nivel,
         -- El estado sale del nivel, no de una opinion: 0 es ok, 1-3 es
         -- degradado. 'error' lo escribe el error handler, no esto.
         estado = case when coalesce(p_nivel, 3) = 0 then 'ok' else 'degradado' end,
         detalle = coalesce(p_detalle, detalle)
   where id = p_run_id
  returning jsonb_build_object('run_id', id, 'estado', estado, 'nivel', nivel_salida);
$$;

-- ---------------------------------------------------------------------------
-- [F6.7] Donde caen los errores. Una tabla, no un mensaje: si el aviso falla,
-- el error no se pierde igual.
-- ---------------------------------------------------------------------------
create table if not exists public.v4_errores (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  fecha       date not null default v4_hoy(),
  workflow    text,
  nodo        text,
  mensaje     text,
  ejecucion   text,
  client_id   uuid references public.clients(id) on delete set null,
  avisado     boolean not null default false,
  detalle     jsonb
);

create index if not exists v4_errores_fecha_idx on public.v4_errores (fecha, ts desc);

comment on table public.v4_errores is
  'Todo fallo de la v4 aterriza aca antes de avisarse. La tabla es la verdad; el aviso es una cortesia que puede fallar sin que se pierda el error.';

grant select, insert, update on public.v4_errores to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- [F6.6] Salud del dia. El volumen esperado se compara contra el MISMO DIA DE
-- LA SEMANA: un lunes no se parece a un domingo, y compararlos genera falsas
-- alarmas que despues nadie mira.
-- ---------------------------------------------------------------------------
create or replace function public.v4_salud(p_fecha date default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with param as (select coalesce(p_fecha, v4_hoy()) as fecha),
hoy as (
  select count(*) as notas, count(distinct dominio_norm) as dominios
  from candidatas_raw where fecha = (select fecha from param)
),
mismo_dia as (
  -- Las ultimas 4 apariciones del mismo dia de la semana.
  select coalesce(avg(n)::int, 0) as promedio, count(*) as muestras
  from (
    select count(*) as n from candidatas_raw
    where fecha < (select fecha from param)
      and extract(dow from fecha) = extract(dow from (select fecha from param))
    group by fecha order by fecha desc limit 4
  ) x
),
fuentes as (
  select count(*) filter (where diagnostico = 'ok')  as ok,
         count(*)                                     as intentos,
         count(distinct dominio_norm)                 as dominios
  from fetch_log where fecha = (select fecha from param)
),
mudas as (select count(*) as n from v4_fuentes_mudas)
select jsonb_build_object(
  'fecha', (select fecha from param),
  'pool', (select notas from hoy),
  'dominios_que_aportaron', (select dominios from hoy),
  'esperado_mismo_dia_semana', (select promedio from mismo_dia),
  'muestras_de_referencia', (select muestras from mismo_dia),
  'desvio_pct', case when (select promedio from mismo_dia) > 0
    then round(100.0 * ((select notas from hoy) - (select promedio from mismo_dia)) / (select promedio from mismo_dia), 1)
    else null end,
  'fuentes_ok', (select ok from fuentes),
  'fuentes_intentadas', (select intentos from fuentes),
  'fuentes_mudas', (select n from mudas),
  'errores_hoy', (select count(*) from v4_errores where fecha = (select fecha from param)),
  'avisos', (
    select coalesce(jsonb_agg(a), '[]'::jsonb) from (
      select 'pool_vacio' as a where (select notas from hoy) = 0
      union all
      -- Solo se avisa si hay con que comparar: sin muestras, callarse es mejor
      -- que inventar una alarma.
      select 'pool_muy_bajo' where (select muestras from mismo_dia) >= 2
        and (select promedio from mismo_dia) > 0
        and (select notas from hoy) < (select promedio from mismo_dia) * 0.5
      union all
      select 'muchas_fuentes_caidas' where (select intentos from fuentes) > 0
        and (select ok from fuentes)::numeric / (select intentos from fuentes) < 0.7
      union all
      select 'hubo_errores' where (select count(*) from v4_errores where fecha = (select fecha from param)) > 0
    ) t)
);
$$;

comment on function public.v4_salud(date) is
  'Salud del dia: pool contra el promedio del MISMO dia de la semana, cobertura de fuentes, mudas y errores. No avisa sin muestras de referencia: una alarma inventada se ignora y despues se ignoran todas.';

grant execute on function public.v4_abrir_run(uuid, text, date, text) to anon, authenticated, service_role;
grant execute on function public.v4_cerrar_run(uuid, int, jsonb) to anon, authenticated, service_role;
grant execute on function public.v4_salud(date) to anon, authenticated, service_role;