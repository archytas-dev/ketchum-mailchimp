-- Deuda encontrada el 07/08/2026: el proyecto de Ketchum se creo con el comportamiento
-- LEGACY de Supabase, donde toda tabla nueva en `public` recibe automaticamente GRANT
-- completo (select/insert/update/delete/...) para anon/authenticated/service_role, via
-- default privileges a nivel de base de datos (pg_default_acl, rol postgres).
--
-- Ese comportamiento vive en la config de la plataforma, no en una migracion -- por eso no
-- se reproduce en un proyecto Supabase nuevo (local, staging, o un `supabase projects
-- create` de cero), y Supabase lo va a eliminar del todo el 30/10/2026 incluso en proyectos
-- viejos. Sin esto, la app falla con "permission denied for table X" pese a que RLS este
-- bien configurado (RLS filtra FILAS, pero antes hace falta el permiso a nivel de TABLA).
--
-- Fix: hacerlo explicito ACA, como parte del schema versionado, en vez de depender de un
-- default de la plataforma que ya tiene fecha de baja. `alter default privileges` cubre
-- ademas las tablas que se creen en migraciones FUTURAS, sin tener que repetir esto cada vez.
--
-- La seguridad real sigue siendo RLS (mandamiento: nunca crear una tabla en public sin
-- `enable row level security` + policy). Este grant es ancho a proposito, igual que ya
-- estaba en produccion -- ver [[reference_supabase_local_clone_sin_password]] antes de asumir
-- que esto es "menos seguro": es literalmente el estado actual de produccion, solo que ahora
-- explicito y versionado en vez de implicito en un flag de la plataforma.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
