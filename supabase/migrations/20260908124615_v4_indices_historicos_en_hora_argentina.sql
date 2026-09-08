-- Misma correccion por consistencia. Aca el desfase de un dia en el borde de una
-- ventana de tres no cambia el diagnostico, pero dejar un CURRENT_DATE suelto en
-- la unica vista que quedaba es dejar el proximo copy-paste listo para fallar.
create or replace view public.v4_indices_historicos as
 with x as (
   select c.dominio_norm,
      count(*) as notas,
      count(*) filter (where c.fecha_confiable) as con_fecha,
      count(*) filter (where c.fecha_confiable and c.fecha_pub >= (now() - '7 days'::interval)) as recientes,
      max(c.fecha) as ultimo_dia
     from candidatas_raw c
    where c.fecha >= (v4_hoy() - 2)
    group by c.dominio_norm
  )
 select x.dominio_norm, x.notas, x.con_fecha, x.recientes,
    round(100.0 * x.con_fecha::numeric / nullif(x.notas, 0)::numeric) as pct_con_fecha,
    e.formato, e.transporte,
    coalesce(e.url_recurso, f.url_feed) as url,
    x.ultimo_dia
   from x
     join medios_fuentes f on f.dominio_norm = x.dominio_norm and f.activa is true
     join medios_estrategia e on e.dominio_norm = x.dominio_norm
  where x.notas >= 300 and x.con_fecha::numeric <= greatest(5::numeric, x.notas::numeric * 0.02)
  order by x.notas desc;