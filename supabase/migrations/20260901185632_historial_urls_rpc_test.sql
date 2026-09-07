
create or replace function test.historial_urls(p_client_id uuid, p_desde date default null)
returns setof text
language sql
stable
security definer
set search_path to 'test'
as $function$
  select h.url_norm
  from test.notas_historico_url h
  where h.client_id = p_client_id
    and h.url_norm is not null and h.url_norm <> ''
    and (p_desde is null or h.primera_vez_fecha >= p_desde)
$function$;

grant execute on function test.historial_urls(uuid, date) to anon, authenticated, service_role;
