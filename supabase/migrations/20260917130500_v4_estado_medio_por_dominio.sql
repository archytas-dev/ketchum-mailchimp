-- La grilla habla de "medio", no de una sección puntual. Al pausarlo para un
-- cliente se bloquean todas sus fuentes/secciones de ese dominio y sólo para
-- ese cliente.

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
  v_dominio text;
  v_pendientes integer;
begin
  if not (public.is_staff() or public.has_client_access(p_client_id)) then
    raise exception 'sin acceso al cliente' using errcode = '42501';
  end if;
  select dominio_norm into v_dominio from medios_fuentes where id = p_fuente_id;
  if v_dominio is null or not exists (
    select 1 from medios_suscripcion ms join medios_fuentes mf on mf.id=ms.fuente_id
    where ms.client_id=p_client_id and mf.dominio_norm=v_dominio
  ) then
    raise exception 'fuente no pertenece al cliente' using errcode = '42501';
  end if;
  if p_activo then
    select count(*) into v_pendientes from medios_fuentes mf join medios_suscripcion ms on ms.fuente_id=mf.id
    where ms.client_id=p_client_id and mf.dominio_norm=v_dominio and not mf.activa;
    if v_pendientes > 0 then
      raise exception 'el medio tiene % fuente(s) pendiente(s) de descubrimiento; primero hay que definir feed y transporte', v_pendientes using errcode = '22023';
    end if;
  end if;
  update medios_suscripcion ms set bloqueado=not p_activo,updated_at=now()
  from medios_fuentes mf where ms.fuente_id=mf.id and ms.client_id=p_client_id and mf.dominio_norm=v_dominio;
  return jsonb_build_object('ok',true,'dominio_norm',v_dominio);
end;
$fn$;

revoke all on function public.v4_set_medio_activo(uuid,uuid,boolean) from public,anon;
grant execute on function public.v4_set_medio_activo(uuid,uuid,boolean) to authenticated,service_role;
