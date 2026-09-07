-- La vista excluía solo las fuentes con diagnostico='ok' en la pasada. Consecuencia
-- medida el 04/09: las ~26 que fallan por tanda quedaban pendientes para siempre
-- dentro de la ventana, se reintentaban en cada tanda y tapaban el avance — tres
-- tandas seguidas trajeron practicamente las mismas fuentes y el barrido no converge.
--
-- Regla correcta: en un barrido cada fuente se intenta UNA vez. Lo que falló no se
-- reintenta en la misma ventana: lo toma el barrido siguiente (hay 9 por día), y la
-- re-verificación de estrategia [F3.6] se ocupa de lo que falla sistemáticamente.
--
-- Efecto lateral bueno: la vista se vacía sola a medida que avanza el barrido, así
-- que el recolector se llama siempre con offset=0 y no hay que llevar la cuenta.

create or replace view public.v4_recoleccion_pendientes as
select
  f.id            as fuente_id,
  f.dominio_norm,
  coalesce(e.url_recurso, f.url_feed) as url,
  e.formato,
  e.transporte,
  e.metodo_extraccion
from public.medios_fuentes f
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
where f.activa is true
  and e.transporte is not null
  and e.metodo_extraccion = 'feed'
  and coalesce(e.url_recurso, f.url_feed) like 'http%'
  and not exists (
        -- cualquier intento en esta pasada, ande o no
        select 1 from public.fetch_log l
        where l.fuente_id = f.id
          and l.fecha = current_date
          and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM-DD_HH24')
      )
order by f.dominio_norm;

comment on view public.v4_recoleccion_pendientes is
  'Fuentes que el barrido de la hora actual todavía no intentó. Excluye cualquier intento previo de la misma ventana (ande o no), así cada fuente se pide una sola vez por barrido y la vista converge a vacío. El recolector se llama siempre con offset=0.';
