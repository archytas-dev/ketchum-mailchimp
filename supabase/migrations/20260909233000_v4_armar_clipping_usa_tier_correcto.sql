-- Completa el fix de la migracion anterior (v4_prioriza_monitoreados_y_tiers):
-- esa migracion precalculo el tier correcto en medios_suscripcion.tier (por
-- fuente_id, cruzando tier_norm(medios.nombre) contra tier_norm(tiers.dominio),
-- que en realidad guarda el nombre del medio, no un dominio real), pero
-- armar_clipping() nunca se actualizo para leerlo: seguia con su propio join
-- roto contra tiers por dominio exacto (lower(t.dominio)=lower(c.dominio_norm)),
-- que casi nunca matchea porque t.dominio es un nombre, no un dominio.
--
-- Efecto en produccion: tier y ad_value salian NULL para casi todas las notas,
-- y el campo "medio" mostrado caia al dominio crudo (coalesce(t.medio, dominio_norm)
-- con t siempre nulo). Esto tambien rompia el lookup de ad_value en el email de
-- prueba (v4_email_tier_lookup), que busca por nombre normalizado: recibia un
-- dominio en vez de un nombre y tampoco matcheaba nunca.
--
-- Fix: candidatas_raw.fuente_id ancla el join a medios_suscripcion (ya correcto,
-- por id, no por texto). Se preserva el ad_value especifico por medio de `tiers`
-- cuando existe (via medios_catalogo -> nombre -> tier_norm, mismo criterio que
-- ya audito la migracion anterior: sin alias, sin fuzzy match), y se cae a
-- tier_defaults por el tier ya resuelto en medios_suscripcion cuando no hay
-- entrada especifica. El nombre a mostrar prioriza medios_catalogo.nombre (el
-- catalogo real) sobre el dominio crudo.
create or replace function public.armar_clipping(p_client_id uuid, p_fecha date default null::date, p_modo text default 'prod'::text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
with param as (
  select coalesce(p_fecha, v4_hoy()) as fecha,
         case when p_modo = 'test' then 'test' else 'prod' end as modo
),
notas as (
  select v.candidata_id, v.seccion, v.confianza, v.forzada,
         c.titulo, c.snippet, c.url, c.dominio_norm, c.fecha_pub, c.fecha_confiable,
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
),
por_seccion as (
  select s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'candidata_id', n.candidata_id, 'titulo', n.titulo, 'snippet', n.snippet,
        'url', n.url, 'medio', n.medio, 'dominio', n.dominio_norm,
        'fecha_pub', n.fecha_pub, 'fecha_confiable', n.fecha_confiable,
        'tier', n.tier, 'alcance', n.alcance, 'ad_value', n.ad_value,
        'confianza', n.confianza, 'forzada', n.forzada)
      order by n.ad_value desc nulls last, n.fecha_pub desc nulls last, n.titulo
    ) filter (where n.candidata_id is not null), '[]'::jsonb) as notas,
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
  'modo', (select modo from param),
  'total_notas', (select count(*) from notas),
  'ad_value_total', (select coalesce(sum(ad_value), 0) from notas),
  'sin_valorizar', (select count(*) from notas where ad_value is null),
  'forzadas', (select count(*) from notas where forzada),
  'secciones', coalesce((
    select jsonb_agg(jsonb_build_object(
      'nombre', ps.nombre, 'orden', ps.orden,
      'es_exclusiva', ps.es_exclusiva, 'muestra_ad_value', ps.muestra_ad_value,
      'cantidad', ps.cantidad, 'ad_value', ps.ad_value_seccion,
      'sin_valorizar', ps.sin_valorizar, 'notas', ps.notas
    ) order by ps.orden) from por_seccion ps), '[]'::jsonb)
);
$function$;
