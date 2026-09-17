-- Un medio/fuente puede estar suscripto por varios clientes. Pausar desde la
-- herramienta v4 debe afectar solo esa suscripción, nunca apagar el scraper
-- para los demás clientes.

create or replace function public.v4_set_medio_activo(
  p_client_id uuid,
  p_fuente_id uuid,
  p_activo boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fuente_activa boolean;
begin
  if not (public.is_staff() or public.has_client_access(p_client_id)) then
    raise exception 'sin acceso al cliente' using errcode = '42501';
  end if;
  select activa into v_fuente_activa from medios_fuentes where id = p_fuente_id;
  if not found or not exists (
    select 1 from medios_suscripcion where client_id = p_client_id and fuente_id = p_fuente_id
  ) then
    raise exception 'fuente no pertenece al cliente' using errcode = '42501';
  end if;
  if p_activo and not v_fuente_activa then
    raise exception 'el medio esta pendiente de descubrimiento: primero hay que definir su feed y transporte' using errcode = '22023';
  end if;
  update medios_suscripcion
  set bloqueado = not p_activo, updated_at = now()
  where client_id = p_client_id and fuente_id = p_fuente_id;
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.v4_set_medio_activo(uuid,uuid,boolean) from public, anon;
grant execute on function public.v4_set_medio_activo(uuid,uuid,boolean) to authenticated, service_role;
