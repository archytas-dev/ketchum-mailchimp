-- [W0.18] `import_clipping_v4` — contrato e importador únicos
--
-- Runbook: docs/pipeline-v4/roadmap-webapp-v4.md §3.6, Paso 3.
-- Fixture canónica: supabase/fixtures/clipping_v4_bms_v1.json
--
-- QUÉ RESUELVE
-- Los tres riesgos silenciosos de §2.1 del roadmap, en un solo lugar y en SQL:
--   1. `orden` — se calcula GLOBAL desde 1, cruzando el límite entre secciones. La tabla lo
--      exige (`not null check >= 1`), así que un payload incompleto no puede producir un
--      clipping desordenado: revienta.
--   2. `fecha_pub` — se castea con `at time zone 'America/Argentina/Buenos_Aires'`. Sin eso,
--      una nota de las 22:40 ART queda con la fecha del día siguiente.
--   3. Dedup — UNA sola normalización, `public.url_canonica()`, la misma que ya usa la v4.
--      No se agrega un cuarto normalizador al sistema.
--
-- DÓNDE VIVE Y POR QUÉ
-- En `public`, no en `test`: el Paso 7 promueve el mismo plano a `public.*_v4` y el runbook pide
-- "un único parámetro de destino interno", no dos copias de la lógica. El destino es dinámico
-- (`%I`) y hoy la función **sólo acepta 'test'**. Habilitar 'public_v4' es una línea, y es
-- deliberadamente del Paso 7.
--
-- LO QUE NO HACE, A PROPÓSITO
--   - No toca `public.clippings`, `public.notes` ni ninguna tabla v3. No las nombra siquiera.
--   - No llama a `public.import_clipping`. Es una función nueva, no un wrapper.
--   - No manda mail ni avisa a nadie.
--
-- APLANADO Y ORDEN — la regla, escrita
--   Las secciones se recorren por `secciones[].orden`; dentro de cada una, las notas en el
--   orden en que vienen (armar_clipping ya las ordena por ad_value desc, fecha desc, título).
--   El contador es global: si la sección 1 trae 2 notas, la primera de la sección 2 es la 3.
--   Las notas del equipo (origen <> 'n8n') se preservan y se renumeran DESPUÉS del bloque de
--   n8n, conservando su orden relativo. Reimportar no las pisa ni las reordena entre sí.

create or replace function public.import_clipping_v4(
  p_clipping jsonb,
  p_run_id   text default null,
  p_destino  text default 'test'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_schema      text;
  v_client_id   uuid;
  v_fecha       date;
  v_clip        uuid;
  v_n8n         int := 0;
  v_precarga    int := 0;
  v_dedup_url   int := 0;
  v_pisadas     int := 0;
  v_preservadas int := 0;
begin
  -- ---------------------------------------------------------------- destino
  if p_destino is null or p_destino not in ('test') then
    raise exception 'destino no permitido: %. En esta fase sólo se acepta ''test'' ([W0.18]); ''public_v4'' se habilita en el Paso 7', p_destino
      using errcode = 'invalid_parameter_value';
  end if;
  v_schema := 'test';

  -- ---------------------------------------------------------------- payload
  if p_clipping is null or jsonb_typeof(p_clipping) <> 'object' then
    raise exception 'payload invalido: se esperaba un objeto jsonb' using errcode = 'invalid_parameter_value';
  end if;
  -- coalesce: jsonb_typeof(NULL) da NULL, y NULL <> 'array' no es verdadero.
  -- Sin esto, un payload SIN la clave "secciones" pasaba el control. Lo detecto la prueba de contrato.
  if coalesce(jsonb_typeof(p_clipping->'secciones'), '(ausente)') <> 'array' then
    raise exception 'payload invalido: falta el arreglo "secciones"' using errcode = 'invalid_parameter_value';
  end if;

  v_client_id := nullif(p_clipping->>'client_id','')::uuid;
  v_fecha     := nullif(p_clipping->>'fecha','')::date;

  if v_client_id is null then
    raise exception 'payload invalido: falta client_id' using errcode = 'invalid_parameter_value';
  end if;
  if v_fecha is null then
    raise exception 'payload invalido: falta fecha' using errcode = 'invalid_parameter_value';
  end if;

  -- Guarda: los clientes *-legado son el historico de la v2 y ninguna pantalla los muestra.
  -- Un clipping v4 para uno de ellos no tiene sentido, y ademas rompe el cruce con secciones.
  -- La encontro una fixture que uso el client_id del seed LOCAL, anterior al rename del 24/08:
  -- en produccion ese UUID es bms-legado, no bms.
  if exists (select 1 from public.clients cl where cl.id = v_client_id and cl.slug like '%-legado') then
    raise exception 'client_id % es un cliente legado; el plano v4 no los acepta', v_client_id
      using errcode = 'invalid_parameter_value';
  end if;

  -- ------------------------------------------------- aplanado + orden global
  -- Temporal: el aplanado es SQL estático y legible; sólo las escrituras son dinámicas.
  -- dos llamadas en la misma transaccion colisionaban con el temp table anterior
  drop table if exists _notas_v4;
  create temp table _notas_v4 on commit drop as
  with plano as (
    select
      (s.value->>'orden')::int                                as seccion_orden,
      s.value->>'nombre'                                      as seccion,
      s.ord                                                   as s_ord,
      n.ord                                                   as n_ord,
      nullif(n.value->>'candidata_id','')::uuid               as candidata_id,
      n.value->>'titulo'                                      as titulo,
      n.value->>'snippet'                                     as snippet,
      n.value->>'url'                                         as url,
      n.value->>'medio'                                       as medio,
      n.value->>'dominio'                                     as dominio,
      -- (2) el cast que evita el corrimiento de un día
      (nullif(n.value->>'fecha_pub','')::timestamptz
         at time zone 'America/Argentina/Buenos_Aires')::date  as pub_date,
      (n.value->>'fecha_confiable')::boolean                   as fecha_confiable,
      nullif(n.value->>'tier','')::int                         as tier,
      nullif(n.value->>'alcance','')::bigint                   as alcance,
      nullif(n.value->>'ad_value','')::bigint                  as ad_value,
      nullif(n.value->>'confianza','')::numeric                as confianza,
      coalesce((n.value->>'forzada')::boolean, false)          as forzada,
      n.value->>'motivo_forzada'                               as motivo_forzada,
      -- (3) la única normalización, versionada
      public.url_canonica(n.value->>'url')                     as url_canon
    from jsonb_array_elements(p_clipping->'secciones') with ordinality as s(value, ord)
    cross join lateral jsonb_array_elements(coalesce(s.value->'notas','[]'::jsonb)) with ordinality as n(value, ord)
    where coalesce(n.value->>'titulo','') <> ''
  ),
  unicas as (
    select p.*,
           row_number() over (
             partition by nullif(p.url_canon,'')
             order by p.seccion_orden, p.n_ord
           ) as rn_url
    from plano p
  )
  select
    -- (1) orden GLOBAL desde 1, cruzando secciones
    row_number() over (order by seccion_orden, s_ord, n_ord)::int as orden,
    seccion, titulo, snippet, url, medio, dominio, pub_date, fecha_confiable,
    tier, alcance, ad_value, confianza, forzada, motivo_forzada, candidata_id, url_canon
  from unicas
  where rn_url = 1 or nullif(url_canon,'') is null;

  select count(*) into v_n8n from _notas_v4;

  v_dedup_url := (
    select count(*) from jsonb_array_elements(p_clipping->'secciones') s
    cross join lateral jsonb_array_elements(coalesce(s->'notas','[]'::jsonb)) n
    where coalesce(n->>'titulo','') <> ''
  ) - v_n8n;

  -- ------------------------------------------------------------- el clipping
  execute format($q$
    insert into %I.clippings_v4 (client_id, fecha, estado, n8n_run_id, run_id,
                                 nivel_salida, nivel_motivo, pipeline_version, updated_at)
    values ($1, $2, 'borrador', $3, $4, $5, $6, 'v4', now())
    on conflict (client_id, fecha) do update
      set n8n_run_id   = excluded.n8n_run_id,
          run_id       = excluded.run_id,
          nivel_salida = excluded.nivel_salida,
          nivel_motivo = excluded.nivel_motivo,
          updated_at   = now()
    returning id $q$, v_schema)
  using v_client_id, v_fecha, p_run_id,
        nullif(p_clipping->>'run_id','')::uuid,
        nullif(p_clipping->>'nivel_salida','')::int,
        p_clipping->>'nivel_motivo'
  into v_clip;

  -- Se reemplaza sólo lo de n8n. Lo que cargó o editó el equipo se conserva.
  execute format('delete from %I.notes_v4 where clipping_id = $1 and origen = ''n8n''', v_schema)
    using v_clip;

  execute format($q$
    insert into %I.notes_v4 (clipping_id, seccion, medio, titulo, snippet, url, pub_date,
                             ad_value, orden, incluida, origen, candidata_id, dominio,
                             fecha_confiable, confianza, forzada, motivo_forzada, tier, alcance)
    select $1, seccion, medio, titulo, snippet, url, pub_date,
           ad_value, orden, true, 'n8n', candidata_id, dominio,
           fecha_confiable, confianza, forzada, motivo_forzada, tier, alcance
    from _notas_v4 $q$, v_schema)
    using v_clip;

  -- ------------------------------------------- precarga del MISMO plano v4
  execute format($q$
    insert into %I.notes_v4 (clipping_id, seccion, medio, titulo, snippet, url, pub_date,
                             orden, incluida, origen)
    select $1, p.seccion, p.medio, p.titulo, p.snippet, p.url, p.pub_date,
           $2 + row_number() over (order by p.orden, p.created_at), true, 'cliente'
    from %I.notes_precarga_v4 p
    where p.client_id = $3 and p.fecha = $4 and p.consumed_at is null $q$, v_schema, v_schema)
    using v_clip, v_n8n, v_client_id, v_fecha;

  get diagnostics v_precarga = row_count;

  execute format($q$
    update %I.notes_precarga_v4 set consumed_at = now()
     where client_id = $1 and fecha = $2 and consumed_at is null $q$, v_schema)
    using v_client_id, v_fecha;

  -- ----------------------------- si n8n repite algo del equipo, gana el equipo
  execute format($q$
    delete from %I.notes_v4 n8
     using %I.notes_v4 cl
     where n8.clipping_id = $1 and cl.clipping_id = $1
       and n8.origen = 'n8n' and cl.origen <> 'n8n'
       and (
         (nullif(public.url_canonica(n8.url),'') is not null
          and public.url_canonica(n8.url) = public.url_canonica(cl.url))
         or (public.txt_fold(n8.titulo) = public.txt_fold(cl.titulo))
       ) $q$, v_schema, v_schema)
    using v_clip;

  get diagnostics v_pisadas = row_count;

  -- --------- renumerar lo del equipo DESPUÉS de n8n, conservando su orden relativo
  execute format($q$
    with base as (select count(*) as n from %I.notes_v4 where clipping_id = $1 and origen = 'n8n'),
    reasignadas as (
      select id, (select n from base) + row_number() over (order by orden, created_at) as nuevo
        from %I.notes_v4 where clipping_id = $1 and origen <> 'n8n'
    )
    update %I.notes_v4 t set orden = r.nuevo
      from reasignadas r where t.id = r.id and t.orden is distinct from r.nuevo $q$,
    v_schema, v_schema, v_schema)
    using v_clip;

  execute format('select count(*) from %I.notes_v4 where clipping_id = $1 and origen <> ''n8n''', v_schema)
    using v_clip into v_preservadas;

  return jsonb_build_object(
    'ok', true,
    'destino', v_schema,
    'clipping_id', v_clip,
    'client_id', v_client_id,
    'fecha', v_fecha,
    'notas_n8n', v_n8n - v_pisadas,
    'notas_del_equipo', v_preservadas,
    'precarga_volcada', v_precarga,
    'descartadas_por_url_repetida', v_dedup_url,
    'pisadas_por_el_equipo', v_pisadas
  );
end;
$fn$;

revoke all on function public.import_clipping_v4(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.import_clipping_v4(jsonb, text, text) to service_role;

comment on function public.import_clipping_v4(jsonb, text, text) is
  '[W0.18] Importa la salida de armar_clipping() al plano v4. Aplana secciones, numera orden '
  'global desde 1, castea fecha_pub en ART y dedupea con url_canonica(). Destino sólo "test" '
  'hasta el Paso 7. No toca ninguna tabla v3.';
