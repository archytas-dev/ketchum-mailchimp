-- Pestaña Actividad (TDD §9: visible a cliente/PM/dev, a diferencia de run_stats que
-- quedó 100% staff-only por la decisión del 05/08 -- ver fase0_roles_and_rls.sql).
-- Esta RPC es la puerta sancionada: expone solo los campos agregados que el cliente
-- puede ver (cobertura + embudo), nunca lo que el TDD marca como "telemetría cruda"
-- (costo_openai_usd, ia_chunks_error, duracion_ms, n8n_run_id, trigger_tipo) -- eso
-- sigue siendo staff-only, consultable directo contra run_stats con rol dev/pm.
--
-- SECURITY DEFINER porque run_stats tiene RLS staff-only: la función bypassea esa
-- policy pero re-chequea el acceso a mano con has_client_access antes de devolver nada.
create or replace function get_actividad_resumen(p_client_id uuid, p_dias int default 14)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_result jsonb;
begin
  if not has_client_access(p_client_id) then
    raise exception 'Sin acceso a este cliente';
  end if;

  -- Un cliente puede tener mas de una fila por dia (corridas manuales de prueba,
  -- reintentos). Nos quedamos con la mas reciente por fecha, no con la suma --
  -- sumar duplicaria el embudo si alguien reejecuto el workflow a mano el mismo dia.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.fecha desc), '[]'::jsonb)
  into v_result
  from (
    select distinct on (fecha)
      fecha, medios_intentados, medios_ok, medios_sin_resultado,
      notas_fetched, notas_post_dedup, notas_post_ia, notas_enviadas,
      keywords_totales, keywords_con_match
    from run_stats
    where client_id = p_client_id
      and fecha >= current_date - p_dias
    order by fecha desc, created_at desc
  ) r;

  return v_result;
end;
$$;

revoke execute on function get_actividad_resumen(uuid, int) from public;
grant execute on function get_actividad_resumen(uuid, int) to authenticated;
