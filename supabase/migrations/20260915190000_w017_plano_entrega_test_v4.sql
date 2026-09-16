-- [W0.17] Plano de entrega aislado: `test.*_v4`
--
-- Runbook: docs/pipeline-v4/roadmap-webapp-v4.md §3.6, Paso 2.
-- Depende de [W0.16] + [W0.16b] (aplicadas 15/09): el schema `test` ya no es alcanzable por
-- `anon`, y las RPC v4 de `public` ya no son ejecutables por el navegador.
--
-- OBJETIVO
-- Que la herramienta pueda guardar y editar un clipping v4 sin compartir una sola fila ni un
-- solo ID con la v3. `public.clippings` y `public.notes` no se tocan: siguen siendo la
-- operacion real hasta que una persona apruebe [W0.22].
--
-- TRES DESVIOS DELIBERADOS RESPECTO DEL ESPEJO LITERAL DE LA v3
--
-- 1. `notes_v4.orden` es NOT NULL **sin default**.
--    En public.notes es `not null default 0`, y ese default es la causa directa de uno de los
--    riesgos silenciosos de §2.1: si el payload omite `orden`, las 40 notas quedan en 0 y el
--    orden pasa a decidirlo Postgres — distinto entre recargas, y el mail deja de coincidir con
--    la plataforma, sin ningun error. Aca un importador incompleto falla ruidosamente.
--    (No se agrega `unique (clipping_id, orden)`: el editor reordena por swap de dos filas y
--    eso violaria la restriccion a mitad de transaccion salvo haciendola deferrable. Es
--    complejidad a cambio de una garantia que el importador ya da solo.)
--
-- 2. Ninguna FK cruza planos. `notes_v4.clipping_id` apunta a `test.clippings_v4`, jamas a
--    `public.clippings`. Si apuntan a `public.clients` y `auth.users`, que son entidades
--    compartidas de solo lectura: sin eso se pierde integridad referencial sin ganar nada.
--
-- 3. ⚠️ ESTAS TABLAS NO VAN EN `v4_purgar_datos_operativos`.
--    Esa funcion borra `test.notes`, `test.clippings` y `test.reportes` a las 48 h. Los
--    espejos v4 son lo que revisa el equipo, no telemetria. Agregarlos a la purga borraria
--    trabajo humano. Si alguien necesita limpiar, que lo haga por `fecha`, explicito y aparte.
--
-- NOTA DE SEGURIDAD
-- Las policies dependen de `public.is_staff()` y `public.has_client_access()`. El aislamiento
-- de la preview descansa en esas dos funciones, no en el schema: un agujero ahi lo hereda todo
-- el plano v4. Revisar antes del Paso 5.

-- ===========================================================================
-- 0. El schema.
--    En produccion ya existe (lo creo la v3 para su modo prueba). En una base local recien
--    levantada NO existe: nunca estuvo en las migraciones del repo. Sin esto, la migracion
--    falla con "schema test does not exist" y el entorno local no puede tener el plano v4.
-- ===========================================================================
create schema if not exists test;
grant usage on schema test to authenticated, service_role;

-- ===========================================================================
-- 1. Tablas
-- ===========================================================================

create table if not exists test.clippings_v4 (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id),
  fecha            date not null,
  estado           text not null default 'borrador',
  n8n_run_id       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  editor_state     jsonb,
  resumen_ia       jsonb,
  -- columnas v4 desde el dia uno (Paso 2, punto 3)
  nivel_salida     integer check (nivel_salida between 0 and 3),
  nivel_motivo     text,
  pipeline_version text not null default 'v4',
  run_id           uuid,
  constraint clippings_v4_client_fecha_uk unique (client_id, fecha)
);

create table if not exists test.notes_v4 (
  id             uuid primary key default gen_random_uuid(),
  clipping_id    uuid not null references test.clippings_v4(id) on delete cascade,
  seccion        text,
  medio          text,
  titulo         text not null,
  snippet        text,
  url            text,
  pub_date       date,
  ad_value       bigint,
  orden          integer not null,          -- ← sin default, a proposito (desvio 1)
  incluida       boolean not null default true,
  origen         text not null default 'n8n',
  created_at     timestamptz not null default now(),
  pintada        boolean not null default false,
  -- columnas v4 desde el dia uno
  candidata_id    uuid,
  dominio         text,
  fecha_confiable boolean,
  confianza       numeric,
  forzada         boolean not null default false,
  motivo_forzada  text,
  tier            integer,
  alcance         bigint,
  constraint notes_v4_orden_positivo check (orden >= 1)   -- 0 dejaba de distinguirse de "sin orden"
);

create table if not exists test.activity_v4 (
  id          uuid primary key default gen_random_uuid(),
  clipping_id uuid references test.clippings_v4(id) on delete cascade,
  user_id     uuid references auth.users(id),
  accion      text not null,
  note_id     uuid references test.notes_v4(id) on delete set null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists test.exports_v4 (
  id          uuid primary key default gen_random_uuid(),
  clipping_id uuid not null references test.clippings_v4(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  html        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint exports_v4_clipping_user_uk unique (clipping_id, user_id)
);

create table if not exists test.summaries_v4 (
  id           uuid primary key default gen_random_uuid(),
  clipping_id  uuid not null references test.clippings_v4(id) on delete cascade,
  texto        text,
  version      integer not null default 1,
  generated_at timestamptz not null default now()
);

create table if not exists test.user_clipping_state_v4 (
  user_id      uuid not null references auth.users(id),
  clipping_id  uuid not null references test.clippings_v4(id) on delete cascade,
  editor_state jsonb,
  updated_at   timestamptz not null default now(),
  primary key (user_id, clipping_id)
);

create table if not exists test.notes_precarga_v4 (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id),
  fecha       date not null,
  seccion     text,
  medio       text,
  titulo      text not null,
  snippet     text,
  url         text,
  pub_date    date,
  orden       integer not null default 0,   -- aca 0 SI es valido: es orden de carga, no de salida
  created_at  timestamptz not null default now(),
  consumed_at timestamptz
);

create table if not exists test.reportes_v4 (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id),
  user_id     uuid references auth.users(id),
  clipping_id uuid references test.clippings_v4(id) on delete set null,
  nota_url    text,
  tipo        text,
  descripcion text not null,
  estado      text not null default 'abierto',
  resolucion  text,
  created_at  timestamptz not null default now(),
  resuelto_at timestamptz,
  fecha       date
);

-- ===========================================================================
-- 2. Indices
-- ===========================================================================

create index if not exists clippings_v4_client_fecha_idx     on test.clippings_v4 (client_id, fecha desc);
create index if not exists notes_v4_clipping_orden_idx       on test.notes_v4 (clipping_id, orden);
create index if not exists notes_v4_candidata_idx            on test.notes_v4 (candidata_id) where candidata_id is not null;
create index if not exists activity_v4_clipping_idx          on test.activity_v4 (clipping_id, created_at desc);
create index if not exists exports_v4_clipping_idx           on test.exports_v4 (clipping_id);
create index if not exists summaries_v4_clipping_idx         on test.summaries_v4 (clipping_id, version desc);
create index if not exists precarga_v4_pendiente_idx         on test.notes_precarga_v4 (client_id, fecha) where consumed_at is null;
create index if not exists reportes_v4_client_estado_idx     on test.reportes_v4 (client_id, estado);

-- ===========================================================================
-- 3. RLS + policies
--    Sin policies estas tablas serian invisibles para `authenticated`, que es quien las va a
--    leer en el Paso 5. Se replica la semantica de la v3: staff ve todo; un usuario cliente ve
--    solo los clientes a los que tiene acceso.
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['clippings_v4','notes_v4','activity_v4','exports_v4',
                           'summaries_v4','user_clipping_state_v4','notes_precarga_v4','reportes_v4']
  loop
    execute format('alter table test.%I enable row level security', t);
    execute format('alter table test.%I force  row level security', t);
  end loop;
end $$;

-- 3a. Tablas con client_id propio
drop policy if exists clippings_v4_acceso on test.clippings_v4;
create policy clippings_v4_acceso on test.clippings_v4
  for all to authenticated
  using      (public.is_staff() or public.has_client_access(client_id))
  with check (public.is_staff() or public.has_client_access(client_id));

drop policy if exists precarga_v4_acceso on test.notes_precarga_v4;
create policy precarga_v4_acceso on test.notes_precarga_v4
  for all to authenticated
  using      (public.is_staff() or public.has_client_access(client_id))
  with check (public.is_staff() or public.has_client_access(client_id));

drop policy if exists reportes_v4_acceso on test.reportes_v4;
create policy reportes_v4_acceso on test.reportes_v4
  for all to authenticated
  using      (public.is_staff() or public.has_client_access(client_id))
  with check (public.is_staff() or public.has_client_access(client_id));

-- 3b. Tablas que heredan el acceso del clipping al que cuelgan
drop policy if exists notes_v4_acceso on test.notes_v4;
create policy notes_v4_acceso on test.notes_v4
  for all to authenticated
  using      (exists (select 1 from test.clippings_v4 c where c.id = clipping_id))
  with check (exists (select 1 from test.clippings_v4 c where c.id = clipping_id));

drop policy if exists activity_v4_acceso on test.activity_v4;
create policy activity_v4_acceso on test.activity_v4
  for all to authenticated
  using      (clipping_id is null or exists (select 1 from test.clippings_v4 c where c.id = clipping_id))
  with check (clipping_id is null or exists (select 1 from test.clippings_v4 c where c.id = clipping_id));

drop policy if exists exports_v4_acceso on test.exports_v4;
create policy exports_v4_acceso on test.exports_v4
  for all to authenticated
  using      (exists (select 1 from test.clippings_v4 c where c.id = clipping_id))
  with check (exists (select 1 from test.clippings_v4 c where c.id = clipping_id));

drop policy if exists summaries_v4_acceso on test.summaries_v4;
create policy summaries_v4_acceso on test.summaries_v4
  for all to authenticated
  using      (exists (select 1 from test.clippings_v4 c where c.id = clipping_id))
  with check (exists (select 1 from test.clippings_v4 c where c.id = clipping_id));

-- 3c. Estado del editor: es de cada usuario, no del cliente
drop policy if exists ucs_v4_acceso on test.user_clipping_state_v4;
create policy ucs_v4_acceso on test.user_clipping_state_v4
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ⚠️ Las policies de 3b se apoyan en la RLS de `clippings_v4`: el EXISTS solo ve los clippings
-- que la policy 3a deja pasar. Es deliberado — un solo lugar donde vive la regla de acceso.

-- ===========================================================================
-- 4. Grants
--    `anon` no recibe nada: quedo sin USAGE sobre el schema en [W0.16] y asi se queda.
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['clippings_v4','notes_v4','activity_v4','exports_v4',
                           'summaries_v4','user_clipping_state_v4','notes_precarga_v4','reportes_v4']
  loop
    execute format('grant select, insert, update, delete on test.%I to authenticated', t);
    execute format('grant all on test.%I to service_role', t);
  end loop;
end $$;

-- ===========================================================================
-- VERIFICACION (Paso 2)
-- ===========================================================================
-- -- a) las 8 existen, con RLS y con policy
-- select c.relname, c.relrowsecurity, c.relforcerowsecurity,
--        (select count(*) from pg_policy p where p.polrelid=c.oid) as policies
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='test' and c.relname like '%\_v4' order by 1;
--
-- -- b) ninguna FK de contenido apunta a public (solo clients y auth.users)
-- select conrelid::regclass as tabla, confrelid::regclass as apunta_a
--   from pg_constraint con join pg_class c on c.oid=con.conrelid
--   join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='test' and con.contype='f' and c.relname like '%\_v4'
--    and confrelid::regclass::text not in ('public.clients','auth.users');
--  -- debe devolver solo FKs hacia test.*_v4
--
-- -- c) anon sigue sin poder
-- --    curl con Accept-Profile: test -> 401 42501
--
-- -- d) baseline v3 sin cambios (ver auditoria/baseline-v3-20260915.md §5)
--
-- ===========================================================================
-- DOWN
-- ===========================================================================
-- drop table if exists test.activity_v4, test.exports_v4, test.summaries_v4,
--                      test.user_clipping_state_v4, test.reportes_v4,
--                      test.notes_v4, test.notes_precarga_v4, test.clippings_v4 cascade;
