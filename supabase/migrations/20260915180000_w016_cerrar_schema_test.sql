-- [W0.16] Cerrar el schema `test` antes de exponerlo en la Data API.
--
-- POR QUE
-- El roadmap de la webapp v4 (docs/pipeline-v4/roadmap-webapp-v4.md, §3) decide que la
-- preview de la herramienta escriba en `test.*_v4` y nunca en las tablas que consume la v3.
-- Para que el navegador llegue ahi hay que exponer el schema `test` en PostgREST, y PostgREST
-- expone SCHEMAS ENTEROS, no tablas sueltas. O sea: el dia que se agregue "test" a
-- config.toml / Data API, TODO lo que viva en `test` queda alcanzable con la anon key.
--
-- ESTADO AUDITADO EL 15/09 (antes de esta migracion)
--   - 32 tablas en `test`. Las 32 con `anon=arwdDxtm` y `authenticated=arwdDxtm`:
--     select, insert, update, DELETE, TRUNCATE, references y trigger.
--   - 28 de esas 32 con RLS DESACTIVADO (las 4 tecnicas de v4 ya tienen RLS, sin policies,
--     que en la practica niega todo a los roles del navegador: eso esta bien).
--   - `test.v4_candidatas_traza`, agregada el 15/09, quedo sin RLS.
--   - Entre las tablas abiertas estan `test.profiles` y `test.user_client_access`.
--   - Las 9 `public.v4_test_*` y las 6 funciones de `test` son SECURITY DEFINER y tienen
--     EXECUTE para PUBLIC ademas de anon/authenticated.
--
-- POR QUE ESTO NO ROMPE EL PIPELINE
-- n8n no toca las tablas de `test` por PostgREST — no puede, el schema no esta expuesto.
-- Entra por los envoltorios `public.v4_test_*`, que son SECURITY DEFINER y corren con los
-- permisos de `postgres`. Revocarle los grants a `anon` sobre las tablas NO les quita nada:
-- verificado sobre las 9 funciones (prosecdef = true, owner postgres).
-- Lo que SI se les quita es el EXECUTE a PUBLIC/anon/authenticated, y por eso esta migracion
-- se lo deja explicito a `service_role`, que es el rol con el que corre la credencial de n8n.
--
-- QUE NO HACE ESTA MIGRACION
--   - No crea `test.*_v4` (eso es [W0.17]).
--   - No expone el schema `test` en la Data API. Exponerlo es un cambio de configuracion
--     aparte, y no debe hacerse hasta que [W0.17] defina las tablas nuevas con sus policies.
--   - No toca nada de `public`. Las funciones `public.armar_clipping` / `auditar_clipping`
--     quedan como estan: son [W0.15] y se revisan por separado.
--
-- REVERSIBLE: el down vuelve a otorgar lo que habia. Esta al final, comentado, porque
-- restaurar `arwdDxtm` para anon es justamente el agujero que cerramos.

begin;

-- ---------------------------------------------------------------------------
-- 1. RLS en todas las tablas de `test`, sin excepcion.
--    Sin policies = nadie que no sea owner o service_role ve una fila. Es el default
--    correcto: las policies se escriben tabla por tabla en [W0.17], y solo para las `*_v4`.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'test' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table %s enable row level security', r.t);
    -- FORCE: que el owner tampoco se saltee la RLS por accidente desde una sesion normal.
    -- service_role sigue pasando porque tiene BYPASSRLS.
    execute format('alter table %s force row level security', r.t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sacarle a los roles del navegador todo permiso sobre las tablas y secuencias.
--    PUBLIC incluido: un grant a PUBLIC alcanza a anon aunque se revoque a anon.
-- ---------------------------------------------------------------------------
revoke all privileges on all tables    in schema test from anon, authenticated, public;
revoke all privileges on all sequences in schema test from anon, authenticated, public;

-- Y que lo nuevo no nazca abierto. Los defaults se aplican por rol creador: `postgres` es
-- quien crea las tablas de este schema (verificado en el ACL auditado).
alter default privileges for role postgres in schema test
  revoke all on tables    from anon, authenticated, public;
alter default privileges for role postgres in schema test
  revoke all on sequences from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 3. USAGE sobre el schema.
--    Sin USAGE no se puede nombrar nada de adentro, ni siquiera con grants de tabla.
--    Se lo sacamos a anon y a PUBLIC. `authenticated` lo conserva porque [W0.17] va a
--    necesitar que un usuario logueado lea `test.*_v4`; las tablas viejas ya quedaron
--    cerradas por el punto 2 y por la RLS del punto 1.
-- ---------------------------------------------------------------------------
revoke usage on schema test from anon, public;
grant  usage on schema test to  authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Funciones.
--    Son SECURITY DEFINER: ejecutarlas es actuar como `postgres`. No pueden quedar
--    disponibles para el navegador ni para PUBLIC.
--    Se revoca primero a PUBLIC (que es de donde viene el `=X/postgres` del ACL) y despues
--    se otorga explicito solo a service_role.
-- ---------------------------------------------------------------------------

-- 4a. Las 6 funciones que viven dentro de `test`.
revoke all privileges on all functions in schema test from anon, authenticated, public;
grant  execute        on all functions in schema test to   service_role;

alter default privileges for role postgres in schema test
  revoke all on functions from anon, authenticated, public;

-- 4b. Los 9 envoltorios `public.v4_test_*` NO se tocan en esta migracion.
--
--     Viven en `public`, que SI esta expuesto, y hoy cualquiera con la anon key puede
--     correr v4_test_armar_clipping o v4_test_guardar_veredictos. Es el agujero mas
--     accesible de los dos y hay que cerrarlo — pero cerrarlo aca seria a ciegas:
--
--     `SECURITY DEFINER` resuelve los permisos DE TABLA de adentro de la funcion.
--     NO resuelve el EXECUTE de la funcion misma. Si la credencial "Ketchum - Supabase"
--     de n8n es la anon key y no la service_role, revocarle EXECUTE a anon devuelve 403
--     en "Abrir corrida del dia" y el armado de los 4 clientes deja de correr.
--     El API de n8n no expone el secreto, asi que desde el repo no se puede saber.
--
--     Va en 20260915181000_w016b_cerrar_v4_test_rpc.sql, que se aplica SOLO despues de
--     confirmar que n8n usa service_role. Todo lo de esta migracion (puntos 1 a 4a) es
--     seguro con cualquiera de las dos keys, porque n8n no alcanza el schema `test` por
--     PostgREST: no esta expuesto, entra unicamente por estos envoltorios de `public`.

commit;

-- ---------------------------------------------------------------------------
-- VERIFICACION (correr despues de aplicar; deben dar 0 filas las tres)
-- ---------------------------------------------------------------------------
-- -- a) tablas de test sin RLS
-- select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='test' and c.relkind='r' and not c.relrowsecurity;
--
-- -- b) tablas de test con algun permiso para anon/authenticated/PUBLIC
-- select c.relname, c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='test' and c.relkind='r'
--    and array_to_string(c.relacl,',') ~ '(^|,)(anon|authenticated)=|(^|,)=';
--
-- -- c) v4_test_* ejecutables por anon/authenticated/PUBLIC
-- select p.proname, p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.proname like 'v4\_test\_%'
--    and array_to_string(p.proacl,',') ~ '(^|,)(anon|authenticated)=|(^|,)=';
--
-- -- d) el pipeline sigue vivo: correr un armado en modo test y confirmar que
-- --    test.v4_pipeline_runs suma una fila con estado 'ok'.
--
-- ---------------------------------------------------------------------------
-- DOWN (no aplicar salvo que haya que volver atras de verdad)
-- ---------------------------------------------------------------------------
-- grant usage on schema test to anon;
-- grant all privileges on all tables    in schema test to anon, authenticated;
-- grant all privileges on all sequences in schema test to anon, authenticated;
-- grant execute on all functions in schema test to anon, authenticated;
-- do $$ declare r record; begin
--   for r in select p.oid::regprocedure as f from pg_proc p
--            join pg_namespace n on n.oid=p.pronamespace
--            where n.nspname='public' and p.proname like 'v4\_test\_%'
--   loop execute format('grant execute on function %s to anon, authenticated', r.f); end loop;
-- end $$;
-- do $$ declare r record; begin
--   for r in select c.oid::regclass as t from pg_class c
--            join pg_namespace n on n.oid=c.relnamespace
--            where n.nspname='test' and c.relkind='r'
--   loop execute format('alter table %s no force row level security', r.t);
--        execute format('alter table %s disable row level security', r.t); end loop;
-- end $$;
