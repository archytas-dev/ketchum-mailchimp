-- Algunas suscripciones heredadas ya marcaban La Nación como monitoreada,
-- pero no tienen la fila equivalente en public.medios. Usamos la fuente
-- existente como autoridad para que esas cuentas (incluida BMS) reciban las
-- nuevas secciones editoriales.
with clientes_monitoreados as (
  select distinct s.client_id
  from public.medios_suscripcion s
  join public.medios_fuentes f on f.id = s.fuente_id
  where f.dominio_norm = 'lanacion.com.ar'
    and s.prioritario is true
), fuentes_nuevas as (
  select id
  from public.medios_fuentes
  where dominio_norm = 'lanacion.com.ar'
    and seccion like 'ln/%'
    and activa is true
)
insert into public.medios_suscripcion (
  client_id, fuente_id, tier, prioritario, origen, vigente_desde, updated_at
)
select c.client_id, f.id, null, true, 'manual_legacy', public.v4_hoy(), now()
from clientes_monitoreados c
cross join fuentes_nuevas f
on conflict (client_id, fuente_id) do update
set prioritario = true,
    origen = excluded.origen,
    updated_at = now();
