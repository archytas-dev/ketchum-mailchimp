-- Endurecimiento de permisos sobre RPCs del plano de pruebas. No cambia ningún
-- comportamiento de la app: los tres casos siguen disponibles para `service_role`,
-- que es con lo que entra n8n. Lo que se quita es el acceso desde el navegador.
--
-- 1. v4_test_snapshot_actividad: SECURITY DEFINER, con EXECUTE para `authenticated`,
--    SIN ningún chequeo de permisos (no llama is_staff() ni has_client_access), y
--    hace `delete from test.v4_run_medios`, `delete from test.v4_run_keywords` y
--    `delete from test.v4_candidatas_traza where etapa='auditor'` para el run_id que
--    se le pase. O sea que cualquier usuario logueado podía borrar y reescribir la
--    traza del auditor de CUALQUIER corrida del plano test, incluidas las de clientes
--    que no son suyos, con solo conocer el uuid. Su hermana
--    v4_test_recuperar_candidata sí arranca con `if not is_staff() then raise`;
--    a esta le faltaba. Ningún punto de la app la llama.
--
-- 2. v4_test_armar_clipping: SECURITY DEFINER y EXECUTE para `authenticated`, también
--    sin chequeo. Es de solo lectura (STABLE), así que el daño posible es menor, pero
--    es superficie innecesaria: la invoca n8n, no el navegador.
--
-- 3. v4_test_preload_notes: la versión legacy de la precarga, que escribe siempre en
--    `test.notes_precarga_v4`. Su gate deja pasar a un usuario cliente, así que si
--    algún camino volviera a llamarla, la precarga de Fedra se perdería en `test`.
--    La app ya usa v4_preload_notes con destino; esta queda solo para service_role.
--
-- 4. v4_preload_notes y v4_recuperar_candidata (las nuevas de hoy): quedaron con
--    EXECUTE para PUBLIC, que es el default de Postgres al crear una función, así que
--    también las alcanzaba `anon`. El chequeo de acceso las salva (sin sesión,
--    auth.uid() es null y has_client_access da false), pero no hay razón para que un
--    usuario sin autenticar pueda invocarlas.

revoke execute on function public.v4_test_snapshot_actividad(uuid) from authenticated;
revoke execute on function public.v4_test_armar_clipping(uuid) from authenticated;
revoke execute on function public.v4_test_preload_notes(uuid, date, jsonb) from authenticated;

revoke execute on function public.v4_preload_notes(uuid, date, jsonb, text) from public;
revoke execute on function public.v4_recuperar_candidata(uuid, uuid, text) from public;
grant execute on function public.v4_preload_notes(uuid, date, jsonb, text) to authenticated;
grant execute on function public.v4_recuperar_candidata(uuid, uuid, text) to authenticated;
