-- [W0.21] Precarga aislada para la herramienta v4.
-- La v3 conserva public.notes_precarga + public.preload_notes intactas.

begin;

create unique index if not exists notes_precarga_v4_uniq
  on test.notes_precarga_v4 (client_id, fecha, public.norm_url(url))
  where consumed_at is null;

create or replace function public.v4_test_preload_notes(
  p_client_id uuid,
  p_fecha     date,
  p_notes     jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_count integer;
begin
  if p_client_id is null or p_fecha is null then
    raise exception 'cliente y fecha son obligatorios' using errcode = '22023';
  end if;
  if jsonb_typeof(p_notes) <> 'array' then
    raise exception 'p_notes debe ser un arreglo' using errcode = '22023';
  end if;
  if not (public.is_staff() or public.has_client_access(p_client_id)) then
    raise exception 'sin acceso al cliente' using errcode = '42501';
  end if;

  insert into test.notes_precarga_v4
    (client_id, fecha, seccion, medio, titulo, snippet, url, pub_date, orden)
  select
    p_client_id, p_fecha,
    coalesce(nullif(n->>'seccion', ''), 'Notas Exclusivas'),
    nullif(n->>'medio', ''), nullif(n->>'titulo', ''), nullif(n->>'snippet', ''),
    nullif(n->>'url', ''), nullif(n->>'pub_date', '')::date,
    coalesce(nullif(n->>'orden', '')::integer, 0)
  from jsonb_array_elements(p_notes) as n
  where nullif(n->>'titulo', '') is not null
    and nullif(n->>'url', '') is not null
  on conflict (client_id, fecha, public.norm_url(url)) where consumed_at is null
  do update set
    seccion = excluded.seccion, medio = excluded.medio, titulo = excluded.titulo,
    snippet = excluded.snippet, pub_date = excluded.pub_date, orden = excluded.orden;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.v4_test_preload_notes(uuid, date, jsonb)
  from public, anon;
grant execute on function public.v4_test_preload_notes(uuid, date, jsonb)
  to authenticated, service_role;

commit;
