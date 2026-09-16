-- [Z.4] El cierre del armado no puede volver a ejecutar el evaluador completo.
--
-- Antes, decidir_nivel() llamaba a v4_evaluar_candidatas() solo para contar si
-- quedaba pool. Eso repetía las regex sobre todas las candidatas y hacía que el
-- armado llegara hasta A2 para después terminar degradado por statement timeout.
-- La ruta de agentes ya tiene la preselección equivalente; reutilizarla evita
-- la segunda pasada cara. El conteo se expresa como muestra: 200 es el tope
-- del RPC y, si se alcanza, significa "200 o más candidatas".

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
  select coalesce(p_fecha, v4_hoy()) as fecha,
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
p as (
  select count(*) as candidatas
  from v4_candidatas_del_dia(
    p_client_id, (select fecha from param), 200)
)
select jsonb_build_object(
  'client_id', p_client_id,
  'fecha', (select fecha from param),
  'modo', (select modo from param),
  'nivel', case
    when (select candidatas from p) = 0 then 3
    when (select juzgadas from v) = 0 then 2
    when (select entran from v) = 0 then 1
    else 0
  end,
  'motivo', case
    when (select candidatas from p) = 0
      then 'sin candidatas: el pool no dio nada para este cliente'
    when (select juzgadas from v) = 0
      then 'sin veredictos: el A2 no corrio o fallo entero'
    when (select entran from v) = 0
      then 'el juez no dejo pasar ninguna'
    else 'completo'
  end,
  -- Es una cota inferior: el RPC tiene limite 200 para que el armado no
  -- convierta el conteo en otro barrido completo del pool.
  'candidatas', (select candidatas from p),
  'candidatas_es_muestra', true,
  'candidatas_tope', 200,
  'juzgadas', (select juzgadas from v),
  'entran', (select entran from v),
  'forzadas', (select forzadas from v),
  'notas_finales', ((select j from a)->>'notas_finales')::int,
  'avisos', ((select j from a)->'avisos'),
  'sale', true
);
$function$;

comment on function public.decidir_nivel(uuid, date, text) is
  'Nivel de salida 0-3. Reusa la preseleccion del armado para no volver a evaluar todo el pool; candidatas es una muestra con tope 200.';

grant execute on function public.decidir_nivel(uuid, date, text)
  to anon, authenticated, service_role;
