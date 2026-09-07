-- [2026-09-02] RPC para el filtro de repetidas del MAIL de los clippings.
-- El nodo "Leer Historial Mail" traia TODO el historial (historial_urls) y filtraba client-side,
-- pero PostgREST capa la respuesta en 1000 filas y varios clientes ya tienen >1200 URLs
-- historicas -> el mail mandaba repetidos que la webapp (import_clipping) si dedupea.
-- Este RPC invierte el flujo: recibe las ~50-80 URLs candidatas del dia y devuelve cuales
-- estan en notas_historico_url. Mismo normalizador (norm_url_historial) e igual tabla que
-- import_clipping -> mail y webapp muestran lo mismo. Payload chico, inmune al tope de filas.

create or replace function public.mail_repetidas(p_client_id uuid, p_urls text[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'ok', true,
    'remove', coalesce(
      (
        select jsonb_agg(distinct x.norm)
        from (
          select norm_url_historial(u) as norm
          from unnest(coalesce(p_urls, '{}'::text[])) as u
        ) x
        where x.norm is not null and x.norm <> ''
          and exists (
            select 1 from notas_historico_url h
            where h.client_id = p_client_id and h.url_norm = x.norm
          )
      ),
      '[]'::jsonb
    )
  )
$function$;

grant execute on function public.mail_repetidas(uuid, text[]) to anon, authenticated, service_role;

-- Clon en el schema de testing (mismo cuerpo, search_path -> test).
create or replace function test.mail_repetidas(p_client_id uuid, p_urls text[])
returns jsonb
language sql
stable
security definer
set search_path to 'test'
as $function$
  select jsonb_build_object(
    'ok', true,
    'remove', coalesce(
      (
        select jsonb_agg(distinct x.norm)
        from (
          select norm_url_historial(u) as norm
          from unnest(coalesce(p_urls, '{}'::text[])) as u
        ) x
        where x.norm is not null and x.norm <> ''
          and exists (
            select 1 from notas_historico_url h
            where h.client_id = p_client_id and h.url_norm = x.norm
          )
      ),
      '[]'::jsonb
    )
  )
$function$;

grant execute on function test.mail_repetidas(uuid, text[]) to anon, authenticated, service_role;
