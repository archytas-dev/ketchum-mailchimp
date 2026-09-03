-- ═══════ Pipeline v4 · Fase 1 · Modelo de datos ═══════
-- Todo aditivo / al lado. No toca `medios`, ni funciones de la v3, ni datos de cliente.
-- Aplicado a produccion el 2026-09-03 (rama feat/pipeline-v4; revision al final de la
-- construccion, no por-migracion). Reversible: DROP de cada objeto nuevo + DROP COLUMN
-- de las columnas agregadas a notas_descartadas.

-- ── 1. Modelo de medios (split de `medios`, que sigue vivo hasta el cutover) ──
create table if not exists medios_catalogo (
  dominio_norm  text primary key,
  nombre        text,
  pais          text,
  ritmo_publicacion_semanal numeric,
  estado        text not null default 'activo' check (estado in ('activo','pausado','muerto')),
  notas         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists medios_estrategia (
  dominio_norm  text primary key references medios_catalogo(dominio_norm) on delete cascade,
  formato       text check (formato in ('rss','wordpress','sitemap','html','google_news')),
  transporte    text check (transporte in ('directo','cloudflare','aws','jina','brightdata')),
  url_recurso   text,
  funciona_desde date,
  ultimo_ok     timestamptz,
  fallos_consecutivos int not null default 0,
  ultimo_diagnostico  text,
  updated_at    timestamptz not null default now()
);

create table if not exists medios_fuentes (
  id            uuid primary key default gen_random_uuid(),
  dominio_norm  text not null references medios_catalogo(dominio_norm) on delete cascade,
  seccion       text not null default 'portada',
  formato       text check (formato in ('rss','wordpress','sitemap','html','google_news')),
  url_feed      text,
  ultimo_ok     timestamptz,
  notas_30d     int not null default 0,
  activa        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists medios_fuentes_dominio_seccion_uk
  on medios_fuentes (dominio_norm, lower(seccion));

create table if not exists medios_suscripcion (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  fuente_id      uuid not null references medios_fuentes(id) on delete cascade,
  tier           int check (tier between 1 and 4),
  prioritario    boolean not null default false,
  origen         text check (origen in ('cliente','auto','manual_legacy','oficial')),
  bloqueado      boolean not null default false,
  motivo_bloqueo text,
  vigente_desde  date not null default current_date,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists medios_suscripcion_client_fuente_uk
  on medios_suscripcion (client_id, fuente_id);
create index if not exists medios_suscripcion_client_idx
  on medios_suscripcion (client_id) where not bloqueado;

comment on table medios_catalogo is 'v4: un dominio, global. Reemplaza el uso de `medios` como catalogo. `medios` sigue vivo hasta el cutover.';
comment on table medios_fuentes is 'v4: la ingesta recorre FUENTES (dominio x seccion), no dominios. Dedup de nota sigue por url_canonica.';

-- ── 2. Reglas de filtrado + prompts de cliente ──
create table if not exists reglas_filtro (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete cascade,
  tipo          text not null check (tipo in ('dominio','patron_titulo','patron_url','tld','idioma','antiguedad','seccion_url')),
  valor         text not null,
  compuerta     text not null default 'puntua' check (compuerta in ('entra_si_o_si','no_entra_nunca','puntua')),
  peso          numeric not null default 0,
  motivo        text,
  activa        boolean not null default true,
  descartes_acumulados int not null default 0,
  reclamos_asociados   int not null default 0,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists reglas_filtro_lookup_idx on reglas_filtro (tipo) where activa;
create index if not exists reglas_filtro_client_idx on reglas_filtro (client_id) where activa;

create table if not exists client_prompts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  version       int not null,
  contenido     text not null,
  vigente_desde timestamptz not null default now(),
  vigente       boolean not null default true,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create unique index if not exists client_prompts_client_version_uk on client_prompts (client_id, version);
create unique index if not exists client_prompts_client_vigente_uk on client_prompts (client_id) where vigente;

comment on table reglas_filtro is 'v4: las 3 compuertas como datos. entra_si_o_si protege lo que el cliente eligio (pedido del cliente sobre las exclusivas).';
comment on table client_prompts is 'v4: instrucciones del juez (A2) por cliente, versionadas y editables desde la plataforma.';

-- ── 3. Ingesta ──
create table if not exists fetch_log (
  id            uuid primary key default gen_random_uuid(),
  ts            timestamptz not null default now(),
  fecha         date not null default current_date,
  dominio_norm  text,
  fuente_id     uuid references medios_fuentes(id) on delete set null,
  pasada        text check (pasada in ('nocturna_1','nocturna_2','nocturna_3','caliente','diurna')),
  formato       text,
  transporte    text,
  http_status   int,
  diagnostico   text check (diagnostico in ('ok','vacio','bloqueado','sin_items','timeout','no_existe','error','no_visitado')),
  articulos     int,
  con_fecha     int,
  ms            int
);
create index if not exists fetch_log_fecha_dominio_idx on fetch_log (fecha, dominio_norm);
create index if not exists fetch_log_fecha_diag_idx     on fetch_log (fecha, diagnostico);

create table if not exists candidatas_raw (
  id             uuid primary key default gen_random_uuid(),
  fecha          date not null default current_date,
  capturado_at   timestamptz not null default now(),
  dominio_norm   text,
  fuente_id      uuid references medios_fuentes(id) on delete set null,
  fetch_log_id   uuid references fetch_log(id) on delete set null,
  url            text not null,
  url_canonica   text,
  titulo         text,
  snippet        text,
  fecha_pub      timestamptz,
  fecha_origen   text check (fecha_origen in ('feed','json_ld','og','url','sin_fecha')),
  fecha_confiable boolean not null default false
);
create index if not exists candidatas_raw_fecha_idx    on candidatas_raw (fecha);
create index if not exists candidatas_raw_canonica_idx on candidatas_raw (url_canonica);

comment on table candidatas_raw is 'v4: pool crudo sin filtrar. Una fila por (fecha, url). El dedup por url_canonica y las 3 compuertas corren despues.';

-- ── 4. Extender notas_descartadas (aditivo, no rompe la v3) ──
alter table notas_descartadas add column if not exists pipeline_run_id   uuid;
alter table notas_descartadas add column if not exists etapa             text;
alter table notas_descartadas add column if not exists regla_id          uuid;
alter table notas_descartadas add column if not exists valor_que_matcheo text;
alter table notas_descartadas add column if not exists explicacion       text;
alter table notas_descartadas add column if not exists recuperable       boolean not null default false;

-- ── 5. Ledger ──
create table if not exists pipeline_runs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  fecha         date not null,
  modo          text not null default 'prod' check (modo in ('prod','ensayo')),
  trigger       text,
  arranco_at    timestamptz not null default now(),
  termino_at    timestamptz,
  nivel_salida  int check (nivel_salida between 0 and 3),
  estado        text not null default 'corriendo' check (estado in ('corriendo','ok','degradado','error')),
  detalle       jsonb
);
create unique index if not exists pipeline_runs_client_fecha_modo_uk on pipeline_runs (client_id, fecha, modo);

create table if not exists stage_events (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references pipeline_runs(id) on delete cascade,
  stage         text not null,
  fase          text not null check (fase in ('in','out')),
  ts            timestamptz not null default now(),
  n_in          int,
  n_out         int,
  ms            int,
  status        text check (status in ('ok','degradado','error')),
  error_txt     text,
  tokens        int,
  costo_usd     numeric,
  modelo        text
);
create index if not exists stage_events_run_idx on stage_events (run_id, ts);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notas_descartadas_regla_id_fkey') then
    alter table notas_descartadas
      add constraint notas_descartadas_regla_id_fkey
      foreign key (regla_id) references reglas_filtro(id) on delete set null not valid;
  end if;
end $$;

comment on column notas_descartadas.etapa is 'v4: normalizacion|compuerta|juez|auditor. Convive con `fase` de la v3 (ai_filter|post_ai|prefilter).';

create or replace function log_stage(p_evento jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_run_id uuid;
begin
  insert into pipeline_runs (client_id, fecha, modo, trigger)
  values (
    (p_evento->>'client_id')::uuid,
    coalesce((p_evento->>'fecha')::date, current_date),
    coalesce(p_evento->>'modo', 'prod'),
    p_evento->>'trigger'
  )
  on conflict (client_id, fecha, modo)
  do update set trigger = coalesce(pipeline_runs.trigger, excluded.trigger)
  returning id into v_run_id;

  insert into stage_events (run_id, stage, fase, n_in, n_out, ms, status, error_txt, tokens, costo_usd, modelo)
  values (
    v_run_id,
    p_evento->>'stage', p_evento->>'fase',
    (p_evento->>'n_in')::int, (p_evento->>'n_out')::int, (p_evento->>'ms')::int,
    p_evento->>'status', p_evento->>'error_txt',
    (p_evento->>'tokens')::int, (p_evento->>'costo_usd')::numeric, p_evento->>'modelo'
  );

  return v_run_id;
end;
$fn$;

create or replace function set_run_outcome(p_run_id uuid, p_nivel int, p_estado text)
returns void language sql security definer set search_path to 'public' as $fn$
  update pipeline_runs
     set termino_at = now(), nivel_salida = p_nivel, estado = coalesce(p_estado, estado)
   where id = p_run_id;
$fn$;

comment on function log_stage(jsonb) is 'v4: lo llaman los subworkflows via RPC (no Execute Workflow). Upsert de pipeline_runs + insert de stage_events.';

-- ── 6. Funciones puras + tier_alias ──
-- (search_path se fija en la migracion siguiente 20260903175136)
create or replace function tier_norm(s text) returns text language sql immutable as $fn$
  select nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(translate(coalesce(s,''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
          '\.com(\.ar)?\y', '', 'g'),
        '^(el|la|los|las)\s+', ''),
      '\s+', ' ', 'g')
  ), '');
$fn$;

create table if not exists tier_alias (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  alias       text not null,
  canonico    text not null,
  motivo      text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create unique index if not exists tier_alias_uk
  on tier_alias (coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), alias);

comment on table tier_alias is 'v4: alta manual desde el dashboard, nunca match por parecido.';

create or replace function url_canonica(u text) returns text language sql immutable as $fn$
  with raw as (select btrim(coalesce(u,'')) as u),
  unwrapped as (
    select coalesce((regexp_match(r.u, '[?&](?:url|q)=(https?(?:://|%3[aA]%2[fF]%2[fF])[^&]+)'))[1], r.u) as u
    from raw r
  ),
  decoded as (
    select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
             u.u, '%3[aA]', ':', 'g'), '%2[fF]', '/', 'g'), '%3[fF]', '?', 'g'),
             '%3[dD]', '=', 'g'), '%26', '&', 'g'), '%3[bB]', ';', 'g') as u
    from unwrapped u
  ),
  bare as (select regexp_replace(regexp_replace(d.u, '^https?://', ''), '^www\.', '') as u from decoded d),
  notrack as (
    select regexp_replace(
             regexp_replace(
               regexp_replace(b.u,
                 '([?&])(utm_[^=&]*|fbclid|gclid|_ga|ref|origin|mc_[^=&]*|igshid|spm)=[^&]*', '\1', 'g'),
             '&&+', '&', 'g'),
           '\?&+', '?', 'g') as u
    from bare b
  ),
  cleaned as (
    select regexp_replace(regexp_replace(regexp_replace(nt.u, '#.*$', ''), '[?&]+$', ''), '/+$', '') as u
    from notrack nt
  ),
  hostlower as (
    select lower(substring(c.u from '^[^/?]+')) || coalesce(substring(c.u from '([/?].*)$'), '') as u
    from cleaned c
  )
  select nullif(u, '') from hostlower;
$fn$;

comment on function url_canonica(text) is 'v1. Fase 4: agregar decode base64 de redirectores del agregador.';

create or replace function resolver_fecha(p_cands jsonb)
returns jsonb language plpgsql stable as $fn$
declare
  v_txt text; v_ts timestamptz; v_m text[];
begin
  foreach v_txt in array array['feed','json_ld','og'] loop
    if (p_cands ? v_txt) and nullif(p_cands->>v_txt, '') is not null then
      begin
        v_ts := (p_cands->>v_txt)::timestamptz;
        return jsonb_build_object('fecha', v_ts, 'origen', v_txt, 'confiable', true);
      exception when others then null;
      end;
    end if;
  end loop;
  if nullif(p_cands->>'url', '') is not null then
    v_m := regexp_match(p_cands->>'url', '/((?:19|20)\d{2})[/-](\d{1,2})(?:[/-](\d{1,2}))?');
    if v_m is not null then
      begin
        v_ts := make_date(v_m[1]::int, v_m[2]::int, coalesce(v_m[3], '1')::int);
        return jsonb_build_object('fecha', v_ts, 'origen', 'url', 'confiable', true);
      exception when others then null;
      end;
    end if;
  end if;
  return jsonb_build_object('fecha', null, 'origen', 'sin_fecha', 'confiable', false);
end;
$fn$;

create or replace function es_repetida(p_client_id uuid, p_url text)
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select exists (
    select 1 from notas_historico_url h
    where h.client_id = p_client_id
      and h.url_norm = url_canonica(p_url)
      and h.primera_vez_fecha >= current_date - 30
  );
$fn$;

-- ── 7. RLS + grants ──
alter table medios_catalogo   enable row level security;
alter table medios_estrategia enable row level security;
alter table medios_fuentes    enable row level security;
alter table reglas_filtro     enable row level security;
alter table client_prompts    enable row level security;
alter table fetch_log         enable row level security;
alter table candidatas_raw    enable row level security;
alter table pipeline_runs     enable row level security;
alter table stage_events      enable row level security;

create policy medios_catalogo_staff   on medios_catalogo   for all using (is_staff()) with check (is_staff());
create policy medios_estrategia_staff on medios_estrategia for all using (is_staff()) with check (is_staff());
create policy medios_fuentes_staff    on medios_fuentes    for all using (is_staff()) with check (is_staff());
create policy reglas_filtro_staff     on reglas_filtro     for all using (is_staff()) with check (is_staff());
create policy client_prompts_staff    on client_prompts    for all using (is_staff()) with check (is_staff());
create policy fetch_log_staff         on fetch_log         for all using (is_staff()) with check (is_staff());
create policy candidatas_raw_staff    on candidatas_raw    for all using (is_staff()) with check (is_staff());
create policy pipeline_runs_staff     on pipeline_runs     for all using (is_staff()) with check (is_staff());
create policy stage_events_staff      on stage_events      for all using (is_staff()) with check (is_staff());

alter table medios_suscripcion enable row level security;
create policy medios_suscripcion_rw on medios_suscripcion for all
  using (has_client_access(client_id)) with check (has_client_access(client_id));

alter table tier_alias enable row level security;
create policy tier_alias_read   on tier_alias for select using (client_id is null or has_client_access(client_id));
create policy tier_alias_write  on tier_alias for insert with check (is_staff());
create policy tier_alias_update on tier_alias for update using (is_staff()) with check (is_staff());
create policy tier_alias_delete on tier_alias for delete using (is_staff());

grant execute on function log_stage(jsonb)                 to anon, authenticated, service_role;
grant execute on function set_run_outcome(uuid, int, text) to anon, authenticated, service_role;
grant execute on function es_repetida(uuid, text)          to anon, authenticated, service_role;
grant execute on function tier_norm(text)                  to anon, authenticated, service_role;
grant execute on function url_canonica(text)               to anon, authenticated, service_role;
grant execute on function resolver_fecha(jsonb)            to anon, authenticated, service_role;

-- ── 8. Schema de ensayo (cerrado, anon sin acceso) ──
create schema if not exists clipping_ensayo;
revoke all on schema clipping_ensayo from public;
grant usage on schema clipping_ensayo to authenticated, service_role;
alter default privileges in schema clipping_ensayo grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema clipping_ensayo grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema clipping_ensayo grant execute on functions to authenticated, service_role;
comment on schema clipping_ensayo is 'v4: schema de ensayo. Estructura espejo de public, RLS obligatorio por tabla, anon sin acceso. Poblado de tablas: Fase 3.';
