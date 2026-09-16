-- [W0.16b + W0.15] Sacarle a anon/authenticated/PUBLIC el EXECUTE sobre las RPC de la v4.
--
-- HALLAZGO (15/09)
-- 20 funciones de `public` son SECURITY DEFINER, ejecutables por `anon`, y ninguna valida
-- `has_client_access`. `public` esta expuesto en la Data API y la anon key viaja en el bundle
-- JS de la herramienta desplegada. Con solo abrir la web y leer el codigo fuente se podia:
--   - leer el clipping armado de cualquier cliente pasando otro client_id
--       armar_clipping · auditar_clipping · decidir_nivel
--   - MUTAR estado del pipeline
--       v4_abrir_run (2 firmas) · v4_cerrar_run · v4_materializar_candidatas
--       v4_tomar_pagina · v4_terminar_pagina
--   - correr los envoltorios de prueba con permisos de postgres
--       los 9 v4_test_*
--
-- POR QUE ES SEGURO REVOCAR
-- La credencial de n8n `Ketchum - Supabase` (id UnEitw6U4SIHjC6X) es la **service_role key**.
-- Probado sin leer el secreto:
--   1. El nodo "Escribir fetch_log (bulk)" del recolector hace POST directo a /rest/v1/fetch_log.
--   2. public.fetch_log tiene RLS activa con una unica policy: is_staff(). Un request con la
--      anon key no la satisface (no hay auth.uid()).
--   3. fetch_log recibio 7.698 filas el 15/09, la ultima a las 14:17 ART.
-- Solo un rol con BYPASSRLS puede haber escrito esas filas. anon no lo tiene; service_role si.
-- => n8n corre como service_role, y conserva EXECUTE explicito en todo lo que sigue.
--
-- LA WEBAPP NO SE VE AFECTADA
-- Sus unicas RPC son get_actividad_resumen, get_pm_final_state y preload_notes (verificado por
-- grep sobre src/). Ninguna cae en este filtro.
--
-- ALCANCE DELIBERADAMENTE ACOTADO
-- No se toca `alter default privileges` sobre el schema `public`: dejaria sin EXECUTE a toda
-- funcion futura que la app necesite, y el sintoma seria dificil de diagnosticar. Esta
-- migracion cierra lo que existe hoy; lo nuevo se revisa cuando se crea.

do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as f
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and (p.proname like 'v4\_%'
           or p.proname in ('armar_clipping','auditar_clipping','decidir_nivel','normalizar_y_compuertas'))
  loop
    execute format('revoke all privileges on function %s from anon, authenticated, public', r.f);
    execute format('grant execute on function %s to service_role', r.f);
    n := n + 1;
  end loop;
  raise notice 'funciones cerradas: %', n;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFICACION (0 filas = cerrado)
-- ---------------------------------------------------------------------------
-- select p.proname
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public'
--    and (p.proname like 'v4\_%' or p.proname in ('armar_clipping','auditar_clipping','decidir_nivel'))
--    and has_function_privilege('anon', p.oid, 'EXECUTE');
--
-- Y que el pipeline siga vivo: que fetch_log sume filas en el proximo barrido (cada 3 h),
-- y que un armado en modo test cierre con estado 'ok'.
--
-- ---------------------------------------------------------------------------
-- DOWN
-- ---------------------------------------------------------------------------
-- do $$ declare r record; begin
--   for r in select p.oid::regprocedure as f from pg_proc p
--            join pg_namespace ns on ns.oid=p.pronamespace
--            where ns.nspname='public'
--              and (p.proname like 'v4\_%'
--                   or p.proname in ('armar_clipping','auditar_clipping','decidir_nivel','normalizar_y_compuertas'))
--   loop execute format('grant execute on function %s to anon, authenticated', r.f); end loop;
-- end $$;
