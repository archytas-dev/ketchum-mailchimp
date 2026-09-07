CREATE OR REPLACE FUNCTION public.get_config_clipping(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'client_id',  c.id,
    'slug',       c.slug,
    'keywords',   (select coalesce(jsonb_agg(to_jsonb(k) - 'client_id'), '[]'::jsonb)
                   from kw_keywords k where k.client_id=c.id and k.activa),
    'medios',     (select coalesce(jsonb_agg(to_jsonb(m) - 'client_id'), '[]'::jsonb)
                   from medios m where m.client_id=c.id and m.activo),
    'alerts',     (select coalesce(jsonb_agg(to_jsonb(a) - 'client_id'), '[]'::jsonb)
                   from google_alerts a where a.client_id=c.id and a.activa),
    'gacetillas', (select coalesce(jsonb_agg(to_jsonb(g) - 'client_id'), '[]'::jsonb)
                   from gacetillas g where g.client_id=c.id and g.estado='BUSCANDO'),
    'tiers',      (select coalesce(jsonb_object_agg(lower(t.dominio),
                     jsonb_build_object('tier',t.tier,'alcance',t.alcance,
                       'ad_value', coalesce(t.ad_value,
                         (select d.ad_value from tier_defaults d
                          where d.client_id=c.id and d.tier=t.tier)))), '{}'::jsonb)
                   from tiers t where t.client_id=c.id),
    'secciones',  (select coalesce(jsonb_agg(to_jsonb(s) - 'client_id' order by s.orden), '[]'::jsonb)
                   from secciones s where s.client_id=c.id and s.activa),
    'dominios_bloqueados', (select coalesce(jsonb_agg(lower(b.dominio)), '[]'::jsonb)
                   from medios_bloqueados_global b where b.activo)
  ) from clients c where c.slug = p_slug;
$function$
