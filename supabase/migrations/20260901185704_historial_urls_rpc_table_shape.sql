
-- reemplaza el returns setof text por returns table(url_norm text): PostgREST devuelve
-- [{"url_norm":"..."}] que n8n mapea a items limpios.
drop function if exists public.historial_urls(uuid, date);
drop function if exists test.historial_urls(uuid, date);

create or replace function public.historial_urls(p_client_id uuid, p_desde date default null)
returns table(url_norm text)
language sql stable security definer set search_path to 'public'
as $function$
  select h.url_norm
  from public.notas_historico_url h
  where h.client_id = p_client_id
    and h.url_norm is not null and h.url_norm <> ''
    and (p_desde is null or h.primera_vez_fecha >= p_desde)
$function$;
grant execute on function public.historial_urls(uuid, date) to anon, authenticated, service_role;

create or replace function test.historial_urls(p_client_id uuid, p_desde date default null)
returns table(url_norm text)
language sql stable security definer set search_path to 'test'
as $function$
  select h.url_norm
  from test.notas_historico_url h
  where h.client_id = p_client_id
    and h.url_norm is not null and h.url_norm <> ''
    and (p_desde is null or h.primera_vez_fecha >= p_desde)
$function$;
grant execute on function test.historial_urls(uuid, date) to anon, authenticated, service_role;
