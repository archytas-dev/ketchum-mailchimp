create table public.exports (
  id uuid primary key default gen_random_uuid(),
  clipping_id uuid not null references public.clippings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  html text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clipping_id, user_id)
);
create index on public.exports (clipping_id);

alter table public.exports enable row level security;

create policy "exports_owner_all" on public.exports for all
  using (
    user_id = auth.uid()
    and exists (select 1 from public.clippings c where c.id = exports.clipping_id and public.has_client_access(c.client_id))
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.clippings c where c.id = exports.clipping_id and public.has_client_access(c.client_id))
  );
