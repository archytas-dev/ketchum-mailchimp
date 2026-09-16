-- Optimiza la lectura de lotes. La versión anterior calculaba el total y el
-- match de keywords sobre todo el remanente antes de aplicar el límite.
-- Primero se toma la página chica; después se enriquecen esas filas.

drop function if exists public.v4_candidatas_del_lote(uuid, bigint, integer);
drop function if exists public.v4_test_candidatas_del_lote(uuid, bigint, integer);

create or replace function public.v4_candidatas_del_lote(
  p_run_id uuid, p_desde_orden bigint default 0, p_limite int default 20
)
returns table (
  orden bigint, total_candidatas bigint, candidata_id uuid, titulo text, snippet text, url text,
  dominio_norm text, fecha_pub timestamptz, fecha_confiable boolean, es_prioritaria boolean,
  transporte text, keyword_match text, grupo text, etiqueta text
)
language sql stable security definer set search_path to 'public'
as $fn$
  with remaining as materialized (
    select pc.orden, pc.candidata_id, pc.es_prioritaria
    from pipeline_run_candidatas pc
    left join candidatas_veredicto cv
      on cv.client_id = (select client_id from pipeline_runs where id = p_run_id)
     and cv.fecha = (select fecha from pipeline_runs where id = p_run_id)
     and cv.modo = (select modo from pipeline_runs where id = p_run_id)
     and cv.candidata_id = pc.candidata_id
    where pc.run_id = p_run_id
      and pc.orden > greatest(0, coalesce(p_desde_orden, 0))
      and cv.candidata_id is null
  ), pagina as materialized (
    select r.orden, r.candidata_id, r.es_prioritaria, c.titulo, c.snippet, c.url,
      c.dominio_norm, c.fecha_pub, c.fecha_confiable,
      (select count(*) from remaining) as total_candidatas
    from remaining r join candidatas_raw c on c.id = r.candidata_id
    order by r.orden limit greatest(1, least(coalesce(p_limite, 20), 200))
  )
  select p.orden, p.total_candidatas, p.candidata_id, p.titulo, p.snippet, p.url,
    p.dominio_norm, p.fecha_pub, p.fecha_confiable, p.es_prioritaria,
    coalesce(me.transporte, 'directo') as transporte,
    kw.keyword as keyword_match, kw.grupo,
    case when ms.origen = 'cliente' then 'SITIO MONITOREADO'
         when t.id is not null then 'MEDIO CON TIER' else '' end as etiqueta
  from pagina p
  left join medios_estrategia me on me.dominio_norm = p.dominio_norm
  left join medios_suscripcion ms on ms.client_id = (select client_id from pipeline_runs where id = p_run_id)
                                and ms.fuente_id = (select fuente_id from candidatas_raw where id = p.candidata_id)
  left join tiers t on t.client_id = (select client_id from pipeline_runs where id = p_run_id)
                   and lower(t.dominio) = lower(p.dominio_norm)
  left join lateral (
    select k.keyword, k.grupo
    from kw_keywords k
    where k.client_id = (select client_id from pipeline_runs where id = p_run_id) and k.activa
      and (' ' || v4_keyword_norm(coalesce(p.titulo, '') || ' ' || coalesce(p.snippet, '')) || ' ')
          like ('% ' || v4_keyword_norm(k.keyword) || ' %')
    order by
      case when v4_keyword_norm(k.grupo) in ('cardiologia', 'oncologia', 'artritis', 'psoriasis', 'trasplantes', 'sin grupo') then 1 else 0 end,
      length(v4_keyword_norm(k.keyword)) desc, k.keyword
    limit 1
  ) kw on true;
$fn$;

create or replace function public.v4_test_candidatas_del_lote(
  p_run_id uuid, p_desde_orden bigint default 0, p_limite int default 20
)
returns table (
  orden bigint, total_candidatas bigint, candidata_id uuid, titulo text, snippet text, url text,
  dominio_norm text, fecha_pub timestamptz, fecha_confiable boolean, es_prioritaria boolean,
  transporte text, keyword_match text, grupo text, etiqueta text
)
language sql stable security definer set search_path to 'test', 'public'
as $fn$
  with remaining as materialized (
    select pc.orden, pc.candidata_id, pc.es_prioritaria
    from test.v4_pipeline_run_candidatas pc
    left join test.v4_candidatas_veredicto cv on cv.run_id = pc.run_id and cv.candidata_id = pc.candidata_id
    where pc.run_id = p_run_id
      and pc.orden > greatest(0, coalesce(p_desde_orden, 0))
      and cv.candidata_id is null
  ), pagina as materialized (
    select r.orden, r.candidata_id, r.es_prioritaria, c.titulo, c.snippet, c.url,
      c.dominio_norm, c.fecha_pub, c.fecha_confiable,
      (select count(*) from remaining) as total_candidatas
    from remaining r join public.candidatas_raw c on c.id = r.candidata_id
    order by r.orden limit greatest(1, least(coalesce(p_limite, 20), 30))
  )
  select p.orden, p.total_candidatas, p.candidata_id, p.titulo, p.snippet, p.url,
    p.dominio_norm, p.fecha_pub, p.fecha_confiable, p.es_prioritaria,
    coalesce(me.transporte, 'directo') as transporte,
    kw.keyword as keyword_match, kw.grupo,
    case when ms.origen = 'cliente' then 'SITIO MONITOREADO'
         when t.id is not null then 'MEDIO CON TIER' else '' end as etiqueta
  from pagina p
  left join public.medios_estrategia me on me.dominio_norm = p.dominio_norm
  left join public.candidatas_raw cr on cr.id = p.candidata_id
  left join public.medios_suscripcion ms on ms.client_id = (select client_id from test.v4_pipeline_runs where id = p_run_id)
                                and ms.fuente_id = cr.fuente_id
  left join public.tiers t on t.client_id = (select client_id from test.v4_pipeline_runs where id = p_run_id)
                   and lower(t.dominio) = lower(p.dominio_norm)
  left join lateral (
    select k.keyword, k.grupo
    from public.kw_keywords k
    where k.client_id = (select client_id from test.v4_pipeline_runs where id = p_run_id) and k.activa
      and (' ' || public.v4_keyword_norm(coalesce(p.titulo, '') || ' ' || coalesce(p.snippet, '')) || ' ')
          like ('% ' || public.v4_keyword_norm(k.keyword) || ' %')
    order by
      case when public.v4_keyword_norm(k.grupo) in ('cardiologia', 'oncologia', 'artritis', 'psoriasis', 'trasplantes', 'sin grupo') then 1 else 0 end,
      length(public.v4_keyword_norm(k.keyword)) desc, k.keyword
    limit 1
  ) kw on true;
$fn$;

grant execute on function public.v4_candidatas_del_lote(uuid, bigint, int) to anon, authenticated, service_role;
grant execute on function public.v4_test_candidatas_del_lote(uuid, bigint, int) to anon, authenticated, service_role;
