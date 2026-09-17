-- Copia la planilla histórica a la tabla v4 sólo cuando el match por dominio/
-- nombre canónico es único. Las claves se materializan e indexan primero para
-- no cruzar millones de combinaciones ni bloquear la base.

create temp table _v4_seed_tiers on commit drop as
select distinct t.client_id, t.id as tier_id, public.v4_medio_key(k.valor) as clave,
  t.tier, t.ad_value, t.alcance
from public.tiers t
cross join lateral (values (t.medio), (t.dominio)) as k(valor)
where public.v4_medio_key(k.valor) <> '';
create index _v4_seed_tiers_idx on _v4_seed_tiers (client_id, clave);

create temp table _v4_seed_objetivos on commit drop as
select distinct ms.client_id, mf.dominio_norm, public.v4_medio_key(k.valor) as clave
from public.medios_suscripcion ms
join public.medios_fuentes mf on mf.id = ms.fuente_id
join public.medios_catalogo mc on mc.dominio_norm = mf.dominio_norm
cross join lateral (values (mc.nombre), (mc.dominio_norm)) as k(valor)
where public.v4_medio_key(k.valor) <> '';
create index _v4_seed_objetivos_idx on _v4_seed_objetivos (client_id, clave);

with matches as (
  select distinct o.client_id, o.dominio_norm, t.tier_id, t.tier, t.ad_value, t.alcance
  from _v4_seed_objetivos o
  join _v4_seed_tiers t on t.client_id = o.client_id and t.clave = o.clave
), candidatos as (
  select client_id, dominio_norm, tier_id, tier, ad_value, alcance,
    count(*) over (partition by client_id, dominio_norm) as coincidencias,
    row_number() over (partition by client_id, dominio_norm order by tier_id) as rn
  from matches
)
insert into public.v4_valorizaciones_medio
  (client_id, dominio_norm, tier, ad_value, alcance, origen)
select client_id, dominio_norm, tier, ad_value, alcance, 'semilla_v3_no_ambigua'
from candidatos
where coincidencias = 1 and rn = 1
on conflict (client_id, dominio_norm) do nothing;
