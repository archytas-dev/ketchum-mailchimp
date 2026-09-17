-- Mientras se completa la semilla por dominio, v4 conserva el valor histórico
-- como fallback de SOLO LECTURA. La prioridad siempre es v4_valorizaciones_medio.

create or replace function public.v4_resolver_valorizacion(
  p_client_id uuid,
  p_url text default null,
  p_medio text default null
)
returns table (dominio_norm text, nombre text, tier integer, ad_value bigint, alcance bigint)
language sql stable security definer set search_path = public as $fn$
with entrada as (
  select public.v4_dominio_desde_texto(p_url) as dominio_url,
         public.v4_dominio_desde_texto(p_medio) as dominio_medio,
         public.v4_medio_key(p_medio) as medio_key
), candidato as (
  select mc.dominio_norm, mc.nombre, 0 as prioridad from entrada e join medios_catalogo mc on mc.dominio_norm=e.dominio_url
  union all select mc.dominio_norm, mc.nombre, 1 from entrada e join medios_catalogo mc on mc.dominio_norm=e.dominio_medio
  union all select mc.dominio_norm, mc.nombre, 2 from entrada e join medios_catalogo mc on public.v4_medio_key(mc.nombre)=e.medio_key where e.medio_key<>''
  union all select mc.dominio_norm, mc.nombre, 3 from entrada e join tier_alias a on a.client_id=p_client_id and public.v4_medio_key(a.alias)=e.medio_key join medios_catalogo mc on mc.dominio_norm=a.canonico where e.medio_key<>''
), elegido as (
  select dominio_norm,nombre from candidato order by prioridad limit 1
), legacy_candidatos as (
  select t.tier,t.ad_value,t.alcance,count(*) over() as cantidad
  from elegido e join tiers t on t.client_id=p_client_id
   and (public.v4_medio_key(t.medio)=public.v4_medio_key(e.nombre)
     or public.v4_medio_key(t.dominio)=public.v4_medio_key(e.nombre)
     or public.v4_medio_key(t.medio)=public.v4_medio_key(e.dominio_norm)
     or public.v4_medio_key(t.dominio)=public.v4_medio_key(e.dominio_norm))
), legacy as (select tier,ad_value,alcance from legacy_candidatos where cantidad=1 limit 1), suscripcion as (
  select ms.tier from elegido e join medios_fuentes mf on mf.dominio_norm=e.dominio_norm join medios_suscripcion ms on ms.fuente_id=mf.id and ms.client_id=p_client_id where not ms.bloqueado order by ms.prioritario desc,ms.updated_at desc limit 1
)
select e.dominio_norm,coalesce(e.nombre,e.dominio_norm),coalesce(v.tier,l.tier,s.tier),coalesce(v.ad_value,l.ad_value,td.ad_value),coalesce(v.alcance,l.alcance)
from elegido e left join v4_valorizaciones_medio v on v.client_id=p_client_id and v.dominio_norm=e.dominio_norm
left join legacy l on true left join suscripcion s on true left join tier_defaults td on td.client_id=p_client_id and td.tier=coalesce(v.tier,l.tier,s.tier)
limit 1
$fn$;

revoke all on function public.v4_resolver_valorizacion(uuid,text,text) from public, anon;
grant execute on function public.v4_resolver_valorizacion(uuid,text,text) to authenticated, service_role;
