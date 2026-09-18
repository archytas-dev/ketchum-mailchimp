-- Corrección de la migración 20260918030000.
--
-- Ahí revoqué EXECUTE `from public` sobre v4_preload_notes y v4_recuperar_candidata,
-- asumiendo que el permiso de `anon` venía del grant implícito a PUBLIC. No era así:
-- Supabase otorga EXECUTE explícitamente a anon, authenticated y service_role en las
-- funciones nuevas del schema public, y el ACL lo muestra como `anon=X/postgres`. Un
-- revoke a PUBLIC no toca un grant nominal, así que anon siguió pudiendo invocarlas.
--
-- No había exposición real: las dos chequean `is_staff() or has_client_access(...)`, y sin
-- sesión auth.uid() es null, así que anon corta con 42501. Pero no tienen por qué estar
-- al alcance de un usuario sin autenticar.

revoke execute on function public.v4_preload_notes(uuid, date, jsonb, text) from anon;
revoke execute on function public.v4_recuperar_candidata(uuid, uuid, text) from anon;
