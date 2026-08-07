create table if not exists public.user_clipping_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  clipping_id uuid not null references public.clippings(id) on delete cascade,
  editor_state jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, clipping_id)
);

alter table public.user_clipping_state enable row level security;

drop policy if exists ucs_owner_all on public.user_clipping_state;
create policy ucs_owner_all on public.user_clipping_state
  for all
  using (user_id = auth.uid() and exists (
    select 1 from public.clippings c where c.id = clipping_id and public.has_client_access(c.client_id)))
  with check (user_id = auth.uid() and exists (
    select 1 from public.clippings c where c.id = clipping_id and public.has_client_access(c.client_id)));

create index if not exists ucs_clipping_idx on public.user_clipping_state(clipping_id);
