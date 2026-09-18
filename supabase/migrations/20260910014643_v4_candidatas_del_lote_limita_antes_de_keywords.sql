drop function if exists public.v4_candidatas_del_lote(uuid, bigint, integer);
drop function if exists public.v4_test_candidatas_del_lote(uuid, bigint, integer);

-- La migracion de esta noche (v4_entrega_keywords_v3_al_juez) agrego un lateral
-- join de keywords por candidata DENTRO de la misma CTE que calcula
-- count(*) over () -- eso obliga a Postgres a materializar TODA la cola
-- elegible (miles de filas) y correrle el join de keywords a cada una, antes
-- de poder aplicar el limit de la pagina. Con ~10.000 candidatas pendientes
-- por cliente, cada pagina de 20 filas tardaba mas de los 8s de
-- statement_timeout y cancelaba (57014) -- confirmado: las 4 pruebas de hoy
-- (Mars/BMS/Booking/MSD) fallaron identico en "Leer lote".
--
-- Fix: separar el conteo total (barato, sin el join de keywords) del armado
-- de la pagina. El order by + limit corren PRIMERO, sobre las filas
-- elegibles nomas; el join de keywords (y el de medios_estrategia) se aplican
-- DESPUES, solo sobre las <=20 filas ya recortadas. Mismo contrato de salida,
-- mismo criterio de eleccion de keyword (mas especifico primero, grupos
-- genericos al final).
create or replace function public.v4_candidatas_del_lote(
  p_run_id uuid, p_desde_orden bigint default 0, p_limite int default 20
)
returns table (
  orden bigint, total_candidatas bigint, candidata_id uuid, titulo text, snippet text, url text,
  dominio_norm text, fecha_pub timestamptz, fecha_confiable boolean, es_prioritaria boolean,
  transporte text, keyword_match text, grupo text
)
language sql stable security definer set search_path to 'public'
as $fn$
  with elegibles as (
    select pc.orden, pc.candidata_id, pc.es_prioritaria
    from pipeline_run_candidatas pc
    join pipeline_runs pr on pr.id = pc.run_id
    left join candidatas_veredicto cv
      on cv.client_id = pr.client_id and cv.fecha = pr.fecha and cv.modo = pr.modo and cv.candidata_id = pc.candidata_id
    where pc.run_id = p_run_id and pc.orden > greatest(0, coalesce(p_desde_orden, 0)) and cv.candidata_id is null
  ),
  total as (
    select count(*) as n from elegibles
  ),
  pagina as (
    select orden, candidata_id, es_prioritaria
    from elegibles
    order by orden
    limit greatest(1, least(coalesce(p_limite, 20), 200))
  )
  select
    p.orden, (select n from total) as total_candidatas, c.id as candidata_id, c.titulo, c.snippet, c.url,
    c.dominio_norm, c.fecha_pub, c.fecha_confiable, p.es_prioritaria,
    coalesce(me.transporte, 'directo') as transporte,
    kw.keyword as keyword_match, kw.grupo
  from pagina p
  join candidatas_raw c on c.id = p.candidata_id
  cross join lateral (select pr2.client_id from pipeline_runs pr2 where pr2.id = p_run_id) pr
  left join medios_estrategia me on me.dominio_norm = c.dominio_norm
  left join lateral (
    select k.keyword, k.grupo
    from kw_keywords k
    where k.client_id = pr.client_id and k.activa
      and (' ' || v4_keyword_norm(coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) || ' ')
          like ('% ' || v4_keyword_norm(k.keyword) || ' %')
    order by
      case when v4_keyword_norm(k.grupo) in ('cardiologia', 'oncologia', 'artritis', 'psoriasis', 'trasplantes', 'sin grupo') then 1 else 0 end,
      length(v4_keyword_norm(k.keyword)) desc, k.keyword
    limit 1
  ) kw on true
  order by p.orden;
$fn$;

create or replace function public.v4_test_candidatas_del_lote(
  p_run_id uuid, p_desde_orden bigint default 0, p_limite int default 20
)
returns table (
  orden bigint, total_candidatas bigint, candidata_id uuid, titulo text, snippet text, url text,
  dominio_norm text, fecha_pub timestamptz, fecha_confiable boolean, es_prioritaria boolean,
  transporte text, keyword_match text, grupo text
)
language sql stable security definer set search_path to 'test', 'public'
as $fn$
  with elegibles as (
    select pc.orden, pc.candidata_id, pc.es_prioritaria
    from test.v4_pipeline_run_candidatas pc
    join test.v4_pipeline_runs pr on pr.id = pc.run_id
    left join test.v4_candidatas_veredicto cv on cv.run_id = pc.run_id and cv.candidata_id = pc.candidata_id
    where pc.run_id = p_run_id and pc.orden > greatest(0, coalesce(p_desde_orden, 0)) and cv.candidata_id is null
  ),
  total as (
    select count(*) as n from elegibles
  ),
  pagina as (
    select orden, candidata_id, es_prioritaria
    from elegibles
    order by orden
    limit greatest(1, least(coalesce(p_limite, 20), 30))
  )
  select
    p.orden, (select n from total) as total_candidatas, c.id as candidata_id, c.titulo, c.snippet, c.url,
    c.dominio_norm, c.fecha_pub, c.fecha_confiable, p.es_prioritaria,
    coalesce(me.transporte, 'directo') as transporte,
    kw.keyword as keyword_match, kw.grupo
  from pagina p
  join public.candidatas_raw c on c.id = p.candidata_id
  cross join lateral (select pr2.client_id from test.v4_pipeline_runs pr2 where pr2.id = p_run_id) pr
  left join public.medios_estrategia me on me.dominio_norm = c.dominio_norm
  left join lateral (
    select k.keyword, k.grupo
    from public.kw_keywords k
    where k.client_id = pr.client_id and k.activa
      and (' ' || public.v4_keyword_norm(coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) || ' ')
          like ('% ' || public.v4_keyword_norm(k.keyword) || ' %')
    order by
      case when public.v4_keyword_norm(k.grupo) in ('cardiologia', 'oncologia', 'artritis', 'psoriasis', 'trasplantes', 'sin grupo') then 1 else 0 end,
      length(public.v4_keyword_norm(k.keyword)) desc, k.keyword
    limit 1
  ) kw on true
  order by p.orden;
$fn$;

grant execute on function public.v4_candidatas_del_lote(uuid, bigint, int) to anon, authenticated, service_role;
grant execute on function public.v4_test_candidatas_del_lote(uuid, bigint, int) to anon, authenticated, service_role;
