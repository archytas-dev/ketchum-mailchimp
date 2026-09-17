-- El armado puede tener miles de candidatas. Resuelve la valorización en joins
-- de lote; no invoca el resolver por cada nota. V4 tiene prioridad y el
-- criterio histórico queda sólo como puente de lectura para no perder cobertura.

create or replace function public.v4_test_armar_clipping(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path to 'test','public' as $function$
with run as (
  select * from test.v4_pipeline_runs where id=p_run_id
), notas as (
  select v.candidata_id,v.seccion,v.confianza,v.forzada,
    coalesce(v.titulo,c.titulo) as titulo,coalesce(v.snippet,c.snippet) as snippet,
    c.url,c.dominio_norm,coalesce(v.fecha_pub,c.fecha_pub) as fecha_pub,
    coalesce(v.fecha_confiable,c.fecha_confiable) as fecha_confiable,
    coalesce(vv.ad_value,t.ad_value,td.ad_value) as ad_value,
    coalesce(vv.tier,t.tier,ms.tier) as tier,
    coalesce(vv.alcance,t.alcance) as alcance,
    coalesce(mc.nombre,t.medio,c.dominio_norm) as medio
  from test.v4_candidatas_veredicto v
  join run r on r.id=v.run_id
  join public.candidatas_raw c on c.id=v.candidata_id
  left join public.medios_suscripcion ms on ms.client_id=r.client_id and ms.fuente_id=c.fuente_id
  left join public.medios_catalogo mc on mc.dominio_norm=c.dominio_norm
  left join public.v4_valorizaciones_medio vv on vv.client_id=r.client_id and vv.dominio_norm=c.dominio_norm
  left join public.tiers t on t.client_id=r.client_id
    and public.tier_norm(t.dominio)=public.tier_norm(coalesce(mc.nombre,c.dominio_norm))
  left join public.tier_defaults td on td.client_id=r.client_id and td.tier=coalesce(vv.tier,t.tier,ms.tier)
  where v.run_id=p_run_id and v.entra
), por_seccion as (
  select s.nombre,s.orden,s.es_exclusiva,s.muestra_ad_value,
    coalesce(jsonb_agg(jsonb_build_object(
      'candidata_id',n.candidata_id,'titulo',n.titulo,'snippet',n.snippet,'url',n.url,
      'medio',n.medio,'dominio',n.dominio_norm,'fecha_pub',n.fecha_pub,
      'fecha_confiable',n.fecha_confiable,'tier',n.tier,'alcance',n.alcance,
      'ad_value',n.ad_value,'confianza',n.confianza,'forzada',n.forzada
    ) order by n.ad_value desc nulls last,n.fecha_pub desc nulls last,n.titulo)
      filter(where n.candidata_id is not null),'[]'::jsonb) as notas,
    count(n.candidata_id) as cantidad,coalesce(sum(n.ad_value),0) as ad_value_seccion,
    count(*) filter(where n.ad_value is null and n.candidata_id is not null) as sin_valorizar
  from public.secciones s join run r on r.client_id=s.client_id
  left join notas n on n.seccion=s.nombre where s.activa
  group by s.nombre,s.orden,s.es_exclusiva,s.muestra_ad_value
)
select jsonb_build_object(
  'run_id',p_run_id,'client_id',(select client_id from run),'fecha',(select fecha from run),'modo','test',
  'total_notas',(select count(*) from notas),'ad_value_total',(select coalesce(sum(ad_value),0) from notas),
  'sin_valorizar',(select count(*) from notas where ad_value is null),'forzadas',(select count(*) from notas where forzada),
  'secciones',coalesce((select jsonb_agg(jsonb_build_object(
    'nombre',ps.nombre,'orden',ps.orden,'es_exclusiva',ps.es_exclusiva,'muestra_ad_value',ps.muestra_ad_value,
    'cantidad',ps.cantidad,'ad_value',ps.ad_value_seccion,'sin_valorizar',ps.sin_valorizar,'notas',ps.notas
  ) order by ps.orden) from por_seccion ps),'[]'::jsonb)
);
$function$;

revoke all on function public.v4_test_armar_clipping(uuid) from public,anon;
grant execute on function public.v4_test_armar_clipping(uuid) to authenticated,service_role;
