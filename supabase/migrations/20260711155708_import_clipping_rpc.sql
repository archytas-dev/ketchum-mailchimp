create or replace function public.import_clipping(
  p_client_id uuid,
  p_fecha date,
  p_run_id text,
  p_notes jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_clip uuid;
begin
  insert into public.clippings(client_id, fecha, estado, n8n_run_id, updated_at)
  values (p_client_id, p_fecha, 'borrador', p_run_id, now())
  on conflict (client_id, fecha)
    do update set n8n_run_id = excluded.n8n_run_id, updated_at = now()
  returning id into v_clip;

  -- reemplaza solo las notas de n8n; preserva las manuales que agregue el editor
  delete from public.notes where clipping_id = v_clip and origen = 'n8n';

  insert into public.notes(clipping_id, seccion, medio, titulo, snippet, url, pub_date, ad_value, orden, incluida, origen)
  select
    v_clip,
    n->>'seccion',
    n->>'medio',
    n->>'titulo',
    n->>'snippet',
    n->>'url',
    nullif(n->>'pub_date','')::date,
    nullif(n->>'ad_value','')::bigint,
    coalesce((n->>'orden')::int, 0),
    coalesce((n->>'incluida')::boolean, true),
    'n8n'
  from jsonb_array_elements(p_notes) as n
  where coalesce(n->>'titulo','') <> '';

  return v_clip;
end $$;

revoke all on function public.import_clipping(uuid,date,text,jsonb) from public, anon, authenticated;
grant execute on function public.import_clipping(uuid,date,text,jsonb) to service_role;
