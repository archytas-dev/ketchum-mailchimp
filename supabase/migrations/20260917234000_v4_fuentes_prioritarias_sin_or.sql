-- El recolector de feeds se cayó entero el 17/09 23:04 (ejecución 209424):
-- PostgREST devolvió 500 con `57014 canceling statement due to statement timeout`
-- leyendo v4_recoleccion_prioritaria_pendientes con limit=60.
--
-- Causa medida con EXPLAIN ANALYZE: v4_fuentes_prioritarias filtra con dos EXISTS
-- unidos por OR. El planner no puede indexar esa forma, así que la degradó a un
-- filtro sobre un Seq Scan y lo metió dentro de un nested loop, re-ejecutándolo
-- una vez por fila candidata: loops=1000, 1,75M filas recorridas. Encima estimaba
-- rows=1 para el lado externo (los COALESCE de la vista de pendientes le tapan la
-- estadística), que es justo lo que le hace elegir el nested loop.
--
-- Con UNION cada rama es indexable por separado y se materializa una sola vez.
-- Medido sobre la misma consulta: 8.435 ms -> 110 ms, y el anti-join contra
-- fetch_log pasa a usar fetch_log_fuente_ts_desc_idx.
--
-- Equivalencia verificada antes de aplicar: 1752 filas en ambas versiones, con
-- 0 diferencias en los dos sentidos (except en ambas direcciones).
--
-- No hace falta índice nuevo en fetch_log: el que ya existe por (fuente_id, ts)
-- resuelve el anti-join en 0 filas por vuelta una vez que desaparece el nested loop.

create or replace view public.v4_fuentes_prioritarias as
  select f.id as fuente_id,
         f.dominio_norm
    from public.medios_fuentes f
   where f.activa
     and exists (
       select 1
         from public.medios m
        where m.activo
          and m.tipo = any (array['monitoreado'::text, 'adicional'::text])
          and lower(regexp_replace(regexp_replace(regexp_replace(
                btrim(m.dominio), '^https?://'::text, ''::text, 'i'::text),
                '^www[.]'::text, ''::text, 'i'::text),
                '/.*$'::text, ''::text)) = f.dominio_norm
     )
  union
  select f.id as fuente_id,
         f.dominio_norm
    from public.medios_fuentes f
    join public.medios_suscripcion s on s.fuente_id = f.id
   where f.activa
     and coalesce(s.bloqueado, false) = false
     and s.tier is not null;

-- Las estadísticas estaban viejas y contribuían a la mala estimación.
analyze public.medios_fuentes;
analyze public.medios_estrategia;
analyze public.medios;
analyze public.medios_suscripcion;
