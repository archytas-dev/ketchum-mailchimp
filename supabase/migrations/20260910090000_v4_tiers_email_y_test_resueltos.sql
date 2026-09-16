-- El armado productivo ya resolvia `medio` y el tier por fuente. El armado
-- aislado seguia cruzando tiers contra el dominio literal: para una prueba,
-- justamente el email terminaba sin tier aunque el dato existiera. Se unifica
-- el criterio de los dos caminos y el lookup del template cubre tambien el
-- tier que viene de la suscripcion.

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
    coalesce(t.tier, ms.tier) as tier,
    t.alcance,
    coalesce(mc.nombre, t.medio, c.dominio_norm) as medio
  from test.v4_candidatas_veredicto v
  join run r on r.id = v.run_id
  join public.candidatas_raw c on c.id = v.candidata_id
  left join public.medios_suscripcion ms on ms.client_id = r.client_id and ms.fuente_id = c.fuente_id
  left join public.medios_catalogo mc on mc.dominio_norm = c.dominio_norm
  left join public.tiers t on t.client_id = r.client_id
    and public.tier_norm(t.dominio) = public.tier_norm(coalesce(mc.nombre, c.dominio_norm))
  left join public.tier_defaults td on td.client_id = r.client_id and td.tier = coalesce(t.tier, ms.tier)
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

create or replace function public.v4_email_tier_lookup(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with entradas as (
  -- La v3 busca por el nombre a mostrar. `tiers.dominio` guarda ese nombre
  -- canonico; `tiers.medio` conserva su variante de presentacion. Se indexan
  -- ambos para que no dependa de cual llegue al template.
  select v4_email_tier_norm(t.medio) as clave,
    jsonb_build_object('tier', t.tier, 'alcance', t.alcance, 'ad_value', t.ad_value) as dato,
    0 as prioridad
  from tiers t
  where t.client_id = p_client_id and t.medio is not null
  union all
  select v4_email_tier_norm(t.dominio),
    jsonb_build_object('tier', t.tier, 'alcance', t.alcance, 'ad_value', t.ad_value),
    1
  from tiers t
  where t.client_id = p_client_id and t.dominio is not null
  union all
  -- Hay fuentes cuyo tier esta asociado a la suscripcion, no a la planilla
  -- individual. El email debe poder mostrarlo igual, con el ad value default.
  select v4_email_tier_norm(mc.nombre),
    jsonb_build_object('tier', ms.tier, 'alcance', null, 'ad_value', td.ad_value),
    2
  from medios_suscripcion ms
  join medios_fuentes mf on mf.id = ms.fuente_id
  join medios_catalogo mc on mc.dominio_norm = mf.dominio_norm
  left join tier_defaults td on td.client_id = ms.client_id and td.tier = ms.tier
  where ms.client_id = p_client_id and ms.tier is not null and mc.nombre is not null
), unicas as (
  select distinct on (clave) clave, dato
  from entradas
  where clave is not null and clave <> ''
  order by clave, prioridad
)
select jsonb_build_object('lookup', coalesce(jsonb_object_agg(clave, dato), '{}'::jsonb))
from unicas;
$function$;

grant execute on function public.v4_test_armar_clipping(uuid) to anon, authenticated, service_role;
grant execute on function public.v4_email_tier_lookup(uuid) to anon, authenticated, service_role;
