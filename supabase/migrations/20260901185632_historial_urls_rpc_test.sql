
-- El schema test existia manualmente en el remoto original. Declararlo aca hace
-- que una base local pueda reconstruirse desde cero sin depender de ese estado
-- externo. En remoto es un no-op.
create schema if not exists test;

-- Idem para el historial de URLs: la tabla test existia manualmente en el
-- proyecto original. Su forma es la misma que la tabla public de la migracion
-- 20260828151212; el LIKE evita mantener dos definiciones divergentes.
create table if not exists test.notas_historico_url
  (like public.notas_historico_url including all);

-- Las RPC test de septiembre resuelven este nombre con search_path=test. El
-- remoto lo tenia creado manualmente; delegar al normalizador publico preserva
-- exactamente la regla ya versionada, sin duplicar su cuerpo.
create or replace function test.norm_url_historial(u text)
returns text
language sql
immutable
as $function$
  select public.norm_url_historial(u)
$function$;

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
