-- La salud global dice si el pool esta sano, pero no a QUIEN le falto el
-- clipping. Se agrega el corte por cliente: cada uno de los 4 activos con su
-- corrida del dia (o la falta de ella).
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
  -- Las ultimas 4 apariciones del mismo dia de la semana: un lunes no se
  -- parece a un domingo y compararlos genera falsas alarmas.
  select coalesce(avg(n)::int, 0) as promedio, count(*) as muestras
  from (
    select count(*) as n from candidatas_raw
    where fecha < (select fecha from param)
      and extract(dow from fecha) = extract(dow from (select fecha from param))
    group by fecha order by fecha desc limit 4
  ) x
),
fuentes as (
  select count(*) filter (where diagnostico = 'ok') as ok,
         count(*) as intentos,
         count(distinct dominio_norm) as dominios
  from fetch_log where fecha = (select fecha from param)
),
mudas as (select count(*) as n from v4_fuentes_mudas),
-- Los 4 activos: los '-legado' son el historico de la v2, no corren.
activos as (
  select id, slug from clients
  where slug not like '%-legado' and slug in ('bms','booking','mars','msd')
),
por_cliente as (
  select a.slug,
         r.estado, r.nivel_salida, r.modo, r.termino_at,
         (r.id is null) as sin_corrida
  from activos a
  left join lateral (
    select * from pipeline_runs pr
    where pr.client_id = a.id and pr.fecha = (select fecha from param)
    order by (pr.modo = 'prod') desc, pr.arranco_at desc limit 1
  ) r on true
),
errores as (
  select count(*) as n from v4_errores where fecha = (select fecha from param)
)
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
  'errores_hoy', (select n from errores),
  'clientes', (select coalesce(jsonb_agg(jsonb_build_object(
      'slug', slug, 'estado', coalesce(estado, 'no corrio'),
      'nivel', nivel_salida, 'modo', modo, 'termino', termino_at
    ) order by slug), '[]'::jsonb) from por_cliente),
  'clientes_sin_clipping', (select coalesce(jsonb_agg(slug order by slug), '[]'::jsonb)
    from por_cliente where sin_corrida),
  'avisos', (
    select coalesce(jsonb_agg(a), '[]'::jsonb) from (
      select 'pool_vacio' as a where (select notas from hoy) = 0
      union all
      -- Sin muestras para comparar no se avisa: una alarma inventada se ignora,
      -- y despues se ignoran todas.
      select 'pool_muy_bajo' where (select muestras from mismo_dia) >= 2
        and (select promedio from mismo_dia) > 0
        and (select notas from hoy) < (select promedio from mismo_dia) * 0.5
      union all
      select 'muchas_fuentes_caidas' where (select intentos from fuentes) > 0
        and (select ok from fuentes)::numeric / (select intentos from fuentes) < 0.7
      union all
      select 'hubo_errores' where (select n from errores) > 0
      union all
      select 'clientes_sin_clipping' where exists (select 1 from por_cliente where sin_corrida)
      union all
      select 'clipping_degradado' where exists (select 1 from por_cliente where estado = 'degradado')
    ) t)
);
$$;

grant execute on function public.v4_salud(date) to anon, authenticated, service_role;