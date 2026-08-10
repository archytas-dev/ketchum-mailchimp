-- Panel PM (TDD §8.2): necesita leer el editor_state del CLIENTE (Fedra), no el propio -- la
-- policy normal de user_clipping_state es owner-only (user_id = auth.uid()), así que un
-- dev/pm no puede leer la fila de otro usuario directo. Este RPC es la puerta sancionada,
-- igual que get_actividad_resumen para run_stats.
create or replace function get_pm_final_state(p_clipping_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_client_id uuid;
  v_result jsonb;
begin
  select client_id into v_client_id from clippings where id = p_clipping_id;
  if v_client_id is null or not has_client_access(v_client_id) or not is_staff() then
    raise exception 'Sin acceso a este clipping';
  end if;

  -- Si hay más de un usuario con rol cliente para este cliente (no debería pasar hoy), nos
  -- quedamos con el guardado más reciente -- es "lo que el cliente terminó dejando".
  select ucs.editor_state into v_result
  from user_clipping_state ucs
  join profiles p on p.id = ucs.user_id
  where ucs.clipping_id = p_clipping_id and p.rol = 'cliente'
  order by ucs.updated_at desc
  limit 1;

  return v_result; -- null si el cliente todavía no guardó ningún estado para este día
end;
$function$;

revoke execute on function get_pm_final_state(uuid) from public;
grant execute on function get_pm_final_state(uuid) to authenticated;
