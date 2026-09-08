-- El dia del clipping es el dia EN ARGENTINA, no en UTC.
--
-- El recolector escribe candidatas_raw.fecha calculandola en ART. Pero
-- current_date de Postgres es UTC, asi que todos los dias, entre las 21:00 ART
-- y la medianoche, las funciones que usaban ese default miraban el dia
-- siguiente y encontraban el pool vacio. Tres horas por dia en las que el
-- pipeline se veia a si mismo sin datos.
--
-- Encontrado el 07/09 a las 21:0x ART probando el armador: current_date decia
-- 2026-09-08 y el pool tenia 46.509 notas bajo 2026-09-07.
--
-- Es la misma clase de error que [F4.6]: mezclar el reloj del servidor con el
-- del negocio. La diferencia es que aquel se veia en los numeros y este solo
-- aparece en una ventana de tres horas.

create or replace function public.v4_hoy()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

comment on function public.v4_hoy() is
  'El dia de hoy en Argentina. Se usa como default en todo lo que trabaja sobre el pool: current_date es UTC y adelanta el dia 3 horas antes que aca.';

grant execute on function public.v4_hoy() to anon, authenticated, service_role;

-- Se cambia el DEFAULT de las funciones que trabajan sobre el pool. Quien pasa
-- la fecha explicitamente no se ve afectado.
alter function public.v4_evaluar_candidatas(uuid, date) set search_path to 'public';
alter function public.normalizar_y_compuertas(uuid, date, boolean) set search_path to 'public';

create or replace function public.armar_clipping(
  p_client_id uuid,
  p_fecha date default v4_hoy()
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with notas as (
  select v.candidata_id, v.seccion, v.confianza, v.forzada,
         c.titulo, c.snippet, c.url, c.url_canonica, c.dominio_norm,
         c.fecha_pub, c.fecha_confiable,
         coalesce(t.ad_value, td.ad_value) as ad_value,
         t.tier, t.alcance,
         coalesce(t.medio, c.dominio_norm) as medio
  from candidatas_veredicto v
  join candidatas_raw c on c.id = v.candidata_id
  left join tiers t on t.client_id = p_client_id and lower(t.dominio) = lower(c.dominio_norm)
  left join tier_defaults td on td.client_id = p_client_id and td.tier = t.tier
  where v.client_id = p_client_id and v.fecha = p_fecha and v.entra
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
  'client_id', p_client_id,
  'fecha', p_fecha,
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
$$;

grant execute on function public.armar_clipping(uuid, date) to anon, authenticated, service_role;
