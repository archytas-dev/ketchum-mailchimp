
-- RPC para el nodo "Leer Historial Mail" del clipping: devuelve las URLs normalizadas ya
-- vistas en clippings anteriores de un cliente, para que el MAIL no repita notas (igual que
-- import_clipping ya hace para la tabla notes/webapp). SECURITY DEFINER: no depende de la RLS
-- de notas_historico_url (policy is_staff()), igual que get_config_clipping / import_clipping.
create or replace function public.historial_urls(p_client_id uuid, p_desde date default null)
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select h.url_norm
  from public.notas_historico_url h
  where h.client_id = p_client_id
    and h.url_norm is not null and h.url_norm <> ''
    and (p_desde is null or h.primera_vez_fecha >= p_desde)
$function$;

grant execute on function public.historial_urls(uuid, date) to anon, authenticated, service_role;
