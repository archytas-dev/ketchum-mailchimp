-- Entrega al A2 el contexto que ya usaba la v3:
-- keyword_match, grupo y etiqueta de fuente monitoreada.
-- Sin esto el prompt no puede aplicar sus excepciones por sitio.

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
  with pagina as (
    select pc.orden, count(*) over () as total_candidatas, c.id as candidata_id, c.titulo, c.snippet, c.url,
      c.dominio_norm, c.fecha_pub, c.fecha_confiable, pc.es_prioritaria,
      coalesce(me.transporte, 'directo') as transporte,
      kw.keyword as keyword_match, kw.grupo,
      case when ms.origen = 'cliente' then 'SITIO MONITOREADO'
           when t.id is not null then 'MEDIO CON TIER' else '' end as etiqueta
    from pipeline_run_candidatas pc
    join pipeline_runs pr on pr.id = pc.run_id
    join candidatas_raw c on c.id = pc.candidata_id
    left join medios_estrategia me on me.dominio_norm = c.dominio_norm
    left join medios_suscripcion ms on ms.client_id = pr.client_id and ms.fuente_id = c.fuente_id
    left join tiers t on t.client_id = pr.client_id and lower(t.dominio) = lower(c.dominio_norm)
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
    left join candidatas_veredicto cv
      on cv.client_id = pr.client_id and cv.fecha = pr.fecha and cv.modo = pr.modo and cv.candidata_id = pc.candidata_id
    where pc.run_id = p_run_id and pc.orden > greatest(0, coalesce(p_desde_orden, 0)) and cv.candidata_id is null
    order by pc.orden limit greatest(1, least(coalesce(p_limite, 20), 200))
  ) select * from pagina;
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
  with pagina as (
    select pc.orden, count(*) over () as total_candidatas, c.id as candidata_id, c.titulo, c.snippet, c.url,
      c.dominio_norm, c.fecha_pub, c.fecha_confiable, pc.es_prioritaria,
      coalesce(me.transporte, 'directo') as transporte,
      kw.keyword as keyword_match, kw.grupo,
      case when ms.origen = 'cliente' then 'SITIO MONITOREADO'
           when t.id is not null then 'MEDIO CON TIER' else '' end as etiqueta
    from test.v4_pipeline_run_candidatas pc
    join test.v4_pipeline_runs pr on pr.id = pc.run_id
    join public.candidatas_raw c on c.id = pc.candidata_id
    left join public.medios_estrategia me on me.dominio_norm = c.dominio_norm
    left join public.medios_suscripcion ms on ms.client_id = pr.client_id and ms.fuente_id = c.fuente_id
    left join public.tiers t on t.client_id = pr.client_id and lower(t.dominio) = lower(c.dominio_norm)
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
    left join test.v4_candidatas_veredicto cv on cv.run_id = pc.run_id and cv.candidata_id = pc.candidata_id
    where pc.run_id = p_run_id and pc.orden > greatest(0, coalesce(p_desde_orden, 0)) and cv.candidata_id is null
    order by pc.orden limit greatest(1, least(coalesce(p_limite, 20), 30))
  ) select * from pagina;
$fn$;

grant execute on function public.v4_candidatas_del_lote(uuid, bigint, int) to anon, authenticated, service_role;
grant execute on function public.v4_test_candidatas_del_lote(uuid, bigint, int) to anon, authenticated, service_role;
