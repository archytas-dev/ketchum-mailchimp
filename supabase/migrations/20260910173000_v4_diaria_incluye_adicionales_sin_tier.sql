-- El barrido diario debe cubrir todos los medios activos de v3: monitoreados
-- y adicionales, tengan o no tier. Se conservan tambien las fuentes por tier
-- que puedan no estar en ese catalogo. Al seleccionar por dominio, entran las
-- subsecciones activas de cada medio sin tener que enumerarlas por separado.
create or replace view public.v4_fuentes_prioritarias as
with configuradas_v3 as (
  select distinct
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm
  from public.medios m
  where m.activo
    and m.tipo in ('monitoreado', 'adicional')
),
con_tier as (
  select distinct f.id as fuente_id
  from public.medios_suscripcion s
  join public.medios_fuentes f on f.id = s.fuente_id
  where coalesce(s.bloqueado, false) = false
    and s.tier is not null
)
select f.id as fuente_id, f.dominio_norm
from public.medios_fuentes f
where f.activa
  and (
    exists (select 1 from configuradas_v3 m where m.dominio_norm = f.dominio_norm)
    or exists (select 1 from con_tier t where t.fuente_id = f.id)
  );
