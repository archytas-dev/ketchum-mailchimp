-- Dedup histórico de URLs por clipping (evita que notas viejas de sitios sin RSS/pubDate
-- confiable, como pulsoturistico.com.ar, pharmabiz.net, tradeyretail.com, infogei.ar,
-- reingresen día tras día). Promovido desde test tras validarse con corridas reales de
-- Booking en modo TEST el 2026-08-27/28.

create table public.notas_historico_url (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  url_norm text not null,
  titulo text,
  medio text,
  primera_vez_fecha date not null,
  primera_vez_run_id text,
  veces_repetida integer not null default 0,
  ultima_vez_bloqueada timestamptz,
  created_at timestamptz not null default now(),
  constraint notas_historico_url_client_id_url_norm_key unique (client_id, url_norm)
);

create index notas_historico_url_client_url_idx on public.notas_historico_url using btree (client_id, url_norm);

create function public.norm_url_historial(u text)
returns text
language sql
immutable
as $function$
  select coalesce(nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(btrim(coalesce(u,''))), '^https?://', ''),
        '^www\.', ''),
      '#.*$', ''),
    '/+$', ''),
  ''), '')
$function$;

-- Backfill: una fila por (client_id, url_norm) tomando la primera vez que apareció
-- entre las notas n8n ya existentes en public.notes.
insert into public.notas_historico_url (client_id, url_norm, titulo, medio, primera_vez_fecha, primera_vez_run_id)
select distinct on (cl.client_id, public.norm_url_historial(n.url))
  cl.client_id, public.norm_url_historial(n.url), n.titulo, n.medio, cl.fecha, cl.n8n_run_id
from public.notes n
join public.clippings cl on cl.id = n.clipping_id
where n.origen = 'n8n' and public.norm_url_historial(n.url) <> ''
order by cl.client_id, public.norm_url_historial(n.url), cl.fecha asc
on conflict (client_id, url_norm) do nothing;

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

  with candidatas as (
    select
      n->>'seccion' as seccion, n->>'medio' as medio, n->>'titulo' as titulo,
      n->>'snippet' as snippet, n->>'url' as url,
      nullif(n->>'pub_date','')::date as pub_date,
      nullif(n->>'ad_value','')::bigint as ad_value,
      coalesce((n->>'orden')::int, 0) as orden,
      coalesce((n->>'incluida')::boolean, true) as incluida,
      public.norm_url_historial(n->>'url') as url_hist
    from jsonb_array_elements(p_notes) as n
    where coalesce(n->>'titulo','') <> ''
  ),
  ya_vistas as (
    select c.url_hist from candidatas c
    join public.notas_historico_url h on h.client_id = p_client_id and h.url_norm = c.url_hist
    where c.url_hist <> ''
  ),
  bloqueo as (
    update public.notas_historico_url h set
      veces_repetida = h.veces_repetida + 1,
      ultima_vez_bloqueada = now()
    from ya_vistas yv where h.client_id = p_client_id and h.url_norm = yv.url_hist
    returning 1
  )
  insert into public.notes(clipping_id, seccion, medio, titulo, snippet, url, pub_date, ad_value, orden, incluida, origen)
  select v_clip, seccion, medio, titulo, snippet, url, pub_date, ad_value, orden, incluida, 'n8n'
  from candidatas
  where url_hist = '' or url_hist not in (select url_hist from ya_vistas);

  insert into public.notas_historico_url (client_id, url_norm, titulo, medio, primera_vez_fecha, primera_vez_run_id)
  select p_client_id, public.norm_url_historial(n->>'url'), n->>'titulo', n->>'medio', p_fecha, p_run_id
  from jsonb_array_elements(p_notes) as n
  where coalesce(n->>'titulo','') <> '' and public.norm_url_historial(n->>'url') <> ''
  on conflict (client_id, url_norm) do nothing;

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
