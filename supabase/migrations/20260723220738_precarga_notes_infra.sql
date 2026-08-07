
-- normaliza URL para dedup: sin scheme, www, query/#, /amp, barra final
create or replace function public.norm_url(u text) returns text
language sql immutable as $$
  select coalesce(nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(btrim(coalesce(u,''))), '^https?://',''),
          '^www\.',''),
        '[?#].*$',''),
      '/amp/?$',''),
    '/+$',''),
  ''), '')
$$;

-- fold: minuscula + sin acentos, para comparar medio/titulo
create or replace function public.txt_fold(s text) returns text
language sql immutable as $$
  select lower(translate(btrim(coalesce(s,'')),
    'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'))
$$;

-- staging de notas precargadas por el equipo, pendientes de entrar al clipping del dia
create table if not exists public.notes_precarga (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  fecha date not null,
  seccion text,
  medio text,
  titulo text not null,
  snippet text,
  url text,
  pub_date date,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
create index if not exists notes_precarga_lookup on public.notes_precarga (client_id, fecha) where consumed_at is null;
-- una url por cliente+fecha (idempotencia de precarga)
create unique index if not exists notes_precarga_uniq on public.notes_precarga (client_id, fecha, public.norm_url(url)) where consumed_at is null;

alter table public.notes_precarga enable row level security;
drop policy if exists notes_precarga_all on public.notes_precarga;
create policy notes_precarga_all on public.notes_precarga
  for all using (public.has_client_access(client_id))
  with check (public.has_client_access(client_id));

-- RPC para precargar notas desde la herramienta (idempotente por url)
create or replace function public.preload_notes(p_client_id uuid, p_fecha date, p_notes jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count int;
begin
  if not public.has_client_access(p_client_id) then
    raise exception 'sin acceso al cliente';
  end if;
  insert into public.notes_precarga (client_id, fecha, seccion, medio, titulo, snippet, url, pub_date, orden)
  select p_client_id, p_fecha,
    coalesce(nullif(n->>'seccion',''),'Notas Exclusivas'),
    n->>'medio', n->>'titulo', n->>'snippet', n->>'url',
    nullif(n->>'pub_date','')::date,
    coalesce((n->>'orden')::int, 0)
  from jsonb_array_elements(p_notes) as n
  where coalesce(n->>'titulo','') <> ''
  on conflict (client_id, fecha, public.norm_url(url)) where consumed_at is null
    do update set seccion=excluded.seccion, medio=excluded.medio, titulo=excluded.titulo,
      snippet=excluded.snippet, pub_date=excluded.pub_date, orden=excluded.orden;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

