-- Corte operativo para el envio de manana: los barridos leen exclusivamente
-- sitios monitoreados. Los medios adicionales, incluso si tienen tier, no se
-- recolectan en esta ventana. Google Alerts conserva su workflow propio.
create or replace view public.v4_fuentes_prioritarias as
with monitoreadas as (
  select distinct
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm
  from public.medios m
  where m.activo
    and m.tipo = 'monitoreado'
)
select f.id as fuente_id, f.dominio_norm
from public.medios_fuentes f
where f.activa
  and exists (select 1 from monitoreadas m where m.dominio_norm = f.dominio_norm);

comment on view public.v4_fuentes_prioritarias is
  'Ventana operativa: solo sitios monitoreados activos de v3. Los adicionales no entran al barrido; Google Alerts se ejecuta por su workflow propio.';
