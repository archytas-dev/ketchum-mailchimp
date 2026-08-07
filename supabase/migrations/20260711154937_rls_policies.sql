create or replace function public.has_client_access(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_client_access u
    where u.user_id = auth.uid() and u.client_id = cid
  );
$$;

alter table public.clients enable row level security;
alter table public.profiles enable row level security;
alter table public.user_client_access enable row level security;
alter table public.clippings enable row level security;
alter table public.notes enable row level security;
alter table public.summaries enable row level security;
alter table public.activity enable row level security;

create policy "profiles_self_select" on public.profiles for select using (id = auth.uid());
create policy "profiles_self_update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "uca_self_select" on public.user_client_access for select using (user_id = auth.uid());

create policy "clients_access_select" on public.clients for select using (public.has_client_access(id));

create policy "clippings_select" on public.clippings for select using (public.has_client_access(client_id));
create policy "clippings_write" on public.clippings for all using (public.has_client_access(client_id)) with check (public.has_client_access(client_id));

create policy "notes_all" on public.notes for all
  using (exists (select 1 from public.clippings c where c.id = notes.clipping_id and public.has_client_access(c.client_id)))
  with check (exists (select 1 from public.clippings c where c.id = notes.clipping_id and public.has_client_access(c.client_id)));

create policy "summaries_all" on public.summaries for all
  using (exists (select 1 from public.clippings c where c.id = summaries.clipping_id and public.has_client_access(c.client_id)))
  with check (exists (select 1 from public.clippings c where c.id = summaries.clipping_id and public.has_client_access(c.client_id)));

create policy "activity_select" on public.activity for select
  using (clipping_id is null or exists (select 1 from public.clippings c where c.id = activity.clipping_id and public.has_client_access(c.client_id)));
create policy "activity_insert" on public.activity for insert with check (user_id = auth.uid());
