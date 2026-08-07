create table run_stats (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,
  fecha             date not null,
  n8n_run_id        text,
  trigger_tipo      text check (trigger_tipo in ('cron','manual','webhook')),
  medios_intentados int, medios_ok int, medios_sin_resultado int, medios_bloqueados int,
  keywords_totales  int, keywords_con_match int,
  notas_fetched int, notas_post_dedup int, notas_post_ia int, notas_enviadas int,
  ia_chunks_total int, ia_chunks_error int,
  costo_openai_usd  numeric(10,4),
  duracion_ms       int,
  created_at        timestamptz not null default now(),
  unique (client_id, fecha, n8n_run_id)
);

create table notas_descartadas (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  fecha       date not null,
  n8n_run_id  text,
  titulo text, url text, medio text, dominio text,
  fase        text not null,
  motivo      text not null,
  score       numeric,
  created_at  timestamptz not null default now()
);
create index notas_descartadas_client_fecha_idx on notas_descartadas (client_id, fecha);

create table medios_bloqueados (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  dominio      text not null,
  motivo       text,
  http_status  int,
  intentos     int not null default 1,
  primera_vez  timestamptz not null default now(),
  ultima_vez   timestamptz not null default now(),
  resuelto     boolean not null default false
);
create unique index medios_bloqueados_client_dominio_uk on medios_bloqueados (client_id, lower(dominio));

create table url_log (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  url         text not null,
  titulo text, medio text, pub_date date,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','procesado','descartado')),
  created_at  timestamptz not null default now(),
  procesado_at timestamptz,
  unique (client_id, url)
);

create table export_metrics (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  clipping_id  uuid references clippings(id) on delete cascade,
  fecha        date not null,
  seccion text, medio text, titulo text, url text,
  es_gacetilla boolean default false,
  ad_value     bigint,
  origen       text,
  created_at   timestamptz not null default now()
);

