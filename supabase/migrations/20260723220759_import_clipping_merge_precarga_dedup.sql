
create or replace function public.import_clipping(p_client_id uuid, p_fecha date, p_run_id text, p_notes jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_clip uuid;
begin
  insert into public.clippings(client_id, fecha, estado, n8n_run_id, updated_at)
  values (p_client_id, p_fecha, 'borrador', p_run_id, now())
  on conflict (client_id, fecha)
    do update set n8n_run_id = excluded.n8n_run_id, updated_at = now()
  returning id into v_clip;

  -- reemplaza solo las notas de n8n; preserva las manuales/precargadas (origen <> 'n8n')
  delete from public.notes where clipping_id = v_clip and origen = 'n8n';

  insert into public.notes(clipping_id, seccion, medio, titulo, snippet, url, pub_date, ad_value, orden, incluida, origen)
  select
    v_clip, n->>'seccion', n->>'medio', n->>'titulo', n->>'snippet', n->>'url',
    nullif(n->>'pub_date','')::date, nullif(n->>'ad_value','')::bigint,
    coalesce((n->>'orden')::int, 0), coalesce((n->>'incluida')::boolean, true), 'n8n'
  from jsonb_array_elements(p_notes) as n
  where coalesce(n->>'titulo','') <> '';

  -- vuelca la precarga pendiente (origen='cliente'), evitando re-insertar si ya existe por url
  insert into public.notes(clipping_id, seccion, medio, titulo, snippet, url, pub_date, orden, incluida, origen)
  select v_clip, p.seccion, p.medio, p.titulo, p.snippet, p.url, p.pub_date, p.orden, true, 'cliente'
  from public.notes_precarga p
  where p.client_id = p_client_id and p.fecha = p_fecha and p.consumed_at is null
    and not exists (
      select 1 from public.notes x
      where x.clipping_id = v_clip and x.origen <> 'n8n'
        and public.norm_url(x.url) <> '' and public.norm_url(x.url) = public.norm_url(p.url)
    );

  update public.notes_precarga
    set consumed_at = now()
  where client_id = p_client_id and fecha = p_fecha and consumed_at is null;

  -- dedup: si una nota de n8n coincide con una precargada/manual, gana la del cliente
  delete from public.notes n8
  using public.notes cl
  where n8.clipping_id = v_clip and cl.clipping_id = v_clip
    and n8.origen = 'n8n' and cl.origen <> 'n8n'
    and (
      (public.norm_url(n8.url) <> '' and public.norm_url(n8.url) = public.norm_url(cl.url))
      or (
        public.txt_fold(n8.medio) <> '' and public.txt_fold(n8.medio) = public.txt_fold(cl.medio)
        and public.txt_fold(n8.titulo) = public.txt_fold(cl.titulo)
      )
    );

  return v_clip;
end $function$;

