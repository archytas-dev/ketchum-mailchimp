create table config_changelog (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  user_id     uuid references auth.users(id),
  tabla       text not null,
  registro_id uuid,
  accion      text not null check (accion in ('alta','baja','edicion')),
  antes       jsonb,
  despues     jsonb,
  notificado  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index config_changelog_pendientes_idx on config_changelog (notificado, created_at) where not notificado;

create table reportes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  user_id     uuid references auth.users(id),
  clipping_id uuid references clippings(id),
  nota_url    text,
  tipo        text check (tipo in
              ('sin_subtitulo','doble_link','medio_extranjero','duplicada',
               'seccion_incorrecta','falta_nota','otro')),
  descripcion text not null,
  estado      text not null default 'abierto'
              check (estado in ('abierto','en_revision','resuelto','descartado')),
  resolucion  text,
  created_at  timestamptz not null default now(),
  resuelto_at timestamptz
);

