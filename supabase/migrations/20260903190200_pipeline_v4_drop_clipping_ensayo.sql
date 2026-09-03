-- Decision 03/09: en vez de un schema de prueba nuevo se reusa y asegura el `test`
-- que ya existe (la v3 lo usa en modo prueba). El `clipping_ensayo` creado en
-- 20260903174914 queda sin uso -> se dropea. Estaba vacio. Aplicado a produccion el 2026-09-03.

drop schema if exists clipping_ensayo cascade;
