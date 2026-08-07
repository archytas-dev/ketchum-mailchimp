create table kw_keywords (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  keyword     text not null,
  grupo       text not null,
  activa      boolean not null default true,
  notas       text,
  visible_cliente boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index kw_keywords_client_keyword_uk on kw_keywords (client_id, lower(keyword));

create table medios (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  dominio     text not null,
  nombre      text,
  tipo        text not null check (tipo in ('monitoreado','adicional')),
  origen      text not null check (origen in ('cliente','auto','manual_legacy','oficial')),
  metodo      text check (metodo in ('rss','sitemap','jina','feed2json','manual_review')),
  url_feed    text,
  activo      boolean not null default true,
  primer_uso  date,
  notas_total int default 0,
  notas       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index medios_client_dominio_uk on medios (client_id, lower(dominio));
create index medios_client_activo_idx on medios (client_id, activo) where activo;

create table google_alerts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  tema        text not null,
  url_rss     text not null,
  activa      boolean not null default true,
  notas       text,
  created_at  timestamptz not null default now(),
  unique (client_id, url_rss)
);

create table gacetillas (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,
  titulo            text not null,
  descripcion       text,
  producto          text,
  links_directos    text[],
  fecha_enviada     date not null,
  ventana_dias      int not null default 7,
  estado            text not null default 'BUSCANDO'
                    check (estado in ('BUSCANDO','EXPIRADA','PAUSADA')),
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table gacetilla_capturas (
  id            uuid primary key default gen_random_uuid(),
  gacetilla_id  uuid not null references gacetillas(id) on delete cascade,
  medio_host    text not null,
  url           text not null,
  fecha         date not null,
  fase          text,
  created_at    timestamptz not null default now(),
  unique (gacetilla_id, medio_host)
);

create table tiers (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  dominio     text not null,
  medio       text,
  tier        int check (tier between 1 and 4),
  alcance     bigint,
  ad_value    bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index tiers_client_dominio_uk on tiers (client_id, lower(dominio));

create table tier_defaults (
  client_id   uuid not null references clients(id) on delete cascade,
  tier        int not null check (tier between 1 and 4),
  ad_value    bigint not null,
  primary key (client_id, tier)
);

create table secciones (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  nombre      text not null,
  orden       int not null default 0,
  es_exclusiva boolean not null default false,
  muestra_ad_value boolean not null default false,
  alias       text[],
  activa      boolean not null default true
);
create unique index secciones_client_nombre_uk on secciones (client_id, lower(nombre));

