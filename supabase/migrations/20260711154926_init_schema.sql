create extension if not exists "pgcrypto";

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nombre text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  rol text not null default 'editor',
  created_at timestamptz not null default now()
);

create table public.user_client_access (
  user_id uuid references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  primary key (user_id, client_id)
);

create table public.clippings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  fecha date not null,
  estado text not null default 'borrador',
  n8n_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, fecha)
);
create index on public.clippings (client_id, fecha);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  clipping_id uuid not null references public.clippings(id) on delete cascade,
  seccion text,
  medio text,
  titulo text not null,
  snippet text,
  url text,
  pub_date date,
  ad_value bigint,
  orden int not null default 0,
  incluida boolean not null default true,
  origen text not null default 'n8n',
  created_at timestamptz not null default now()
);
create index on public.notes (clipping_id);

create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  clipping_id uuid not null references public.clippings(id) on delete cascade,
  texto text,
  version int not null default 1,
  generated_at timestamptz not null default now()
);
create index on public.summaries (clipping_id);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  clipping_id uuid references public.clippings(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  accion text not null,
  note_id uuid references public.notes(id) on delete set null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index on public.activity (clipping_id);
create index on public.activity (created_at);
