-- La salida de A1 es la version util de una nota: completa copete, titulo y
-- fecha cuando el feed no los trae. Antes se usaba para juzgar, pero se perdia
-- al guardar el veredicto y el email volvia a leer candidatas_raw.
--
-- Se guarda junto al veredicto (tambien en test): no se modifica el pool crudo
-- ni una corrida anterior, y el armado siempre tiene la misma version que vio
-- el juez.

alter table public.candidatas_veredicto
  add column if not exists titulo text,
  add column if not exists snippet text,
  add column if not exists fecha_pub timestamptz,
  add column if not exists fecha_confiable boolean;

alter table test.v4_candidatas_veredicto
  add column if not exists titulo text,
  add column if not exists snippet text,
  add column if not exists fecha_pub timestamptz,
  add column if not exists fecha_confiable boolean;

create or replace function public.v4_test_guardar_veredictos(p_run_id uuid, p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'test', 'public'
as $function$
declare
  v_run test.v4_pipeline_runs%rowtype;
  v_guardadas integer := 0;
begin
  select * into v_run from test.v4_pipeline_runs where id = p_run_id;
  if not found then
    raise exception 'corrida test inexistente: %', p_run_id using errcode = '22023';
  end if;

  insert into test.v4_candidatas_veredicto (
    run_id, candidata_id, entra, seccion, confianza, forzada, motivo_forzada,
    agente, titulo, snippet, fecha_pub, fecha_confiable
  )
  select
    p_run_id, x.candidata_id, coalesce(x.entra, false), nullif(x.seccion, ''),
    x.confianza, coalesce(x.forzada, false), x.motivo_forzada,
    coalesce(nullif(x.agente, ''), 'a2'), nullif(x.titulo, ''), nullif(x.snippet, ''),
    x.fecha_pub, x.fecha_confiable
  from jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb)) as x(
    candidata_id uuid, entra boolean, seccion text, confianza numeric,
    forzada boolean, motivo_forzada text, agente text, titulo text, snippet text,
    fecha_pub timestamptz, fecha_confiable boolean
  )
  join test.v4_pipeline_run_candidatas pc
    on pc.run_id = p_run_id and pc.candidata_id = x.candidata_id
  on conflict (run_id, candidata_id) do update set
    entra = excluded.entra,
    seccion = excluded.seccion,
    confianza = excluded.confianza,
    forzada = excluded.forzada,
    motivo_forzada = excluded.motivo_forzada,
    agente = excluded.agente,
    titulo = excluded.titulo,
    snippet = excluded.snippet,
    fecha_pub = excluded.fecha_pub,
    fecha_confiable = excluded.fecha_confiable,
    created_at = now();

  get diagnostics v_guardadas = row_count;
  return jsonb_build_object('run_id', p_run_id, 'guardadas', v_guardadas);
end;
$function$;

create or replace function public.v4_test_armar_clipping(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'test', 'public'
as $function$
with run as (
  select * from test.v4_pipeline_runs where id = p_run_id
), notas as (
  select
    v.candidata_id, v.seccion, v.confianza, v.forzada,
    coalesce(v.titulo, c.titulo) as titulo,
    coalesce(v.snippet, c.snippet) as snippet,
    c.url, c.dominio_norm,
    coalesce(v.fecha_pub, c.fecha_pub) as fecha_pub,
    coalesce(v.fecha_confiable, c.fecha_confiable) as fecha_confiable,
    coalesce(t.ad_value, td.ad_value) as ad_value,
    t.tier, t.alcance, coalesce(t.medio, c.dominio_norm) as medio
  from test.v4_candidatas_veredicto v
  join run r on r.id = v.run_id
  join public.candidatas_raw c on c.id = v.candidata_id
  left join public.tiers t on t.client_id = r.client_id and lower(t.dominio) = lower(c.dominio_norm)
  left join public.tier_defaults td on td.client_id = r.client_id and td.tier = t.tier
  where v.run_id = p_run_id and v.entra
), por_seccion as (
  select s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value,
    coalesce(jsonb_agg(jsonb_build_object(
      'candidata_id', n.candidata_id, 'titulo', n.titulo, 'snippet', n.snippet,
      'url', n.url, 'medio', n.medio, 'dominio', n.dominio_norm, 'fecha_pub', n.fecha_pub,
      'fecha_confiable', n.fecha_confiable, 'tier', n.tier, 'alcance', n.alcance,
      'ad_value', n.ad_value, 'confianza', n.confianza, 'forzada', n.forzada
    ) order by n.ad_value desc nulls last, n.fecha_pub desc nulls last, n.titulo)
      filter (where n.candidata_id is not null), '[]'::jsonb) as notas,
    count(n.candidata_id) as cantidad,
    coalesce(sum(n.ad_value), 0) as ad_value_seccion,
    count(*) filter (where n.ad_value is null and n.candidata_id is not null) as sin_valorizar
  from public.secciones s
  join run r on r.client_id = s.client_id
  left join notas n on n.seccion = s.nombre
  where s.activa
  group by s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value
)
select jsonb_build_object(
  'run_id', p_run_id, 'client_id', (select client_id from run),
  'fecha', (select fecha from run), 'modo', 'test',
  'total_notas', (select count(*) from notas),
  'ad_value_total', (select coalesce(sum(ad_value), 0) from notas),
  'sin_valorizar', (select count(*) from notas where ad_value is null),
  'forzadas', (select count(*) from notas where forzada),
  'secciones', coalesce((select jsonb_agg(jsonb_build_object(
    'nombre', ps.nombre, 'orden', ps.orden, 'es_exclusiva', ps.es_exclusiva,
    'muestra_ad_value', ps.muestra_ad_value, 'cantidad', ps.cantidad,
    'ad_value', ps.ad_value_seccion, 'sin_valorizar', ps.sin_valorizar,
    'notas', ps.notas
  ) order by ps.orden) from por_seccion ps), '[]'::jsonb)
);
$function$;

create or replace function public.armar_clipping(
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
), notas as (
  select
    v.candidata_id, v.seccion, v.confianza, v.forzada,
    coalesce(v.titulo, c.titulo) as titulo,
    coalesce(v.snippet, c.snippet) as snippet,
    c.url, c.dominio_norm,
    coalesce(v.fecha_pub, c.fecha_pub) as fecha_pub,
    coalesce(v.fecha_confiable, c.fecha_confiable) as fecha_confiable,
    coalesce(t.ad_value, td.ad_value) as ad_value,
    coalesce(t.tier, s.tier) as tier,
    t.alcance,
    coalesce(mc.nombre, t.medio, c.dominio_norm) as medio
  from candidatas_veredicto v
  join candidatas_raw c on c.id = v.candidata_id
  left join medios_suscripcion s on s.client_id = p_client_id and s.fuente_id = c.fuente_id
  left join medios_catalogo mc on mc.dominio_norm = c.dominio_norm
  left join tiers t on t.client_id = p_client_id
    and tier_norm(t.dominio) = tier_norm(coalesce(mc.nombre, c.dominio_norm))
  left join tier_defaults td on td.client_id = p_client_id and td.tier = coalesce(t.tier, s.tier)
  where v.client_id = p_client_id
    and v.fecha = (select fecha from param)
    and v.modo = (select modo from param)
    and v.entra
), por_seccion as (
  select s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value,
    coalesce(jsonb_agg(jsonb_build_object(
      'candidata_id', n.candidata_id, 'titulo', n.titulo, 'snippet', n.snippet,
      'url', n.url, 'medio', n.medio, 'dominio', n.dominio_norm,
      'fecha_pub', n.fecha_pub, 'fecha_confiable', n.fecha_confiable,
      'tier', n.tier, 'alcance', n.alcance, 'ad_value', n.ad_value,
      'confianza', n.confianza, 'forzada', n.forzada
    ) order by n.ad_value desc nulls last, n.fecha_pub desc nulls last, n.titulo)
      filter (where n.candidata_id is not null), '[]'::jsonb) as notas,
    count(n.candidata_id) as cantidad,
    coalesce(sum(n.ad_value), 0) as ad_value_seccion,
    count(*) filter (where n.ad_value is null and n.candidata_id is not null) as sin_valorizar
  from secciones s
  left join notas n on n.seccion = s.nombre
  where s.client_id = p_client_id and s.activa
  group by s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value
)
select jsonb_build_object(
  'client_id', p_client_id, 'fecha', (select fecha from param),
  'modo', (select modo from param), 'total_notas', (select count(*) from notas),
  'ad_value_total', (select coalesce(sum(ad_value), 0) from notas),
  'sin_valorizar', (select count(*) from notas where ad_value is null),
  'forzadas', (select count(*) from notas where forzada),
  'secciones', coalesce((select jsonb_agg(jsonb_build_object(
    'nombre', ps.nombre, 'orden', ps.orden,
    'es_exclusiva', ps.es_exclusiva, 'muestra_ad_value', ps.muestra_ad_value,
    'cantidad', ps.cantidad, 'ad_value', ps.ad_value_seccion,
    'sin_valorizar', ps.sin_valorizar, 'notas', ps.notas
  ) order by ps.orden) from por_seccion ps), '[]'::jsonb)
);
$function$;

grant execute on function public.v4_test_guardar_veredictos(uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.v4_test_armar_clipping(uuid) to anon, authenticated, service_role;
grant execute on function public.armar_clipping(uuid, date, text) to anon, authenticated, service_role;
