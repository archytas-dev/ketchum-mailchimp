-- Segundo capítulo del timeout del recolector de feeds.
--
-- El 17/09 la causa fue v4_fuentes_prioritarias (dos EXISTS unidos por OR, que el planner
-- degradaba a un nested loop). Eso se arregló con UNION y la consulta bajó a 171 ms. Pero
-- la medición se tomó a las 23:50, con el fetch_log del día casi vacío, y ahí estuvo el
-- error de método: el plan que elige el planner depende de cuántas filas tiene fetch_log
-- para la fecha de hoy, y eso crece durante el día.
--
-- Hoy 18/09 a las 06:30 volvió a cortar por statement timeout (ejecución 235767), y
-- midiendo a media mañana la misma consulta da 9.930 ms. El plan muestra por qué: el
-- anti-join contra fetch_log dejó de usar el índice por fuente y pasó a usar el de fecha,
--
--   Index Scan using fetch_log_fecha_diag_idx on fetch_log l  (loops=1528)
--     Index Cond: (fecha = hoy)
--     Filter: (pasada = 'barrido_...')
--     Rows Removed by Filter: 3944
--
-- es decir ~1.528 x ~3.944 = 6 millones de filas descartadas a mano. Con el correr del día
-- fetch_log acumula más filas de la fecha actual y esto empeora, así que los barridos de
-- las 08, 11, 14, 17, 20 y 23 son cada vez más propensos a cortar.
--
-- El predicado real del anti-join es (fuente_id, fecha, pasada). Este índice lo cubre
-- entero, así que cada vuelta pasa a ser una búsqueda directa en vez de un filtrado.
--
-- fetch_log son ~102k filas / 26 MB: la creación es de menos de un segundo.

create index if not exists fetch_log_fuente_fecha_pasada_idx
  on public.fetch_log (fuente_id, fecha, pasada);

analyze public.fetch_log;
