-- Bitacora v4 por candidata. No reutiliza notas_descartadas: esa tabla convive
-- con la v3 y no permite reconstruir de forma confiable una corrida v4.
create table if not exists public.v4_candidatas_traza (
  run_id uuid not null references public.pipeline_runs(id) on delete cascade,
  candidata_id uuid not null references public.candidatas_raw(id) on delete cascade,
  etapa text not null check (etapa in ('preseleccion', 'juez', 'auditor')),
  resultado text not null check (resultado in ('continua', 'entra', 'descarta')),
  motivo text not null,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, candidata_id, etapa)
);

create index if not exists v4_candidatas_traza_run_etapa_idx
  on public.v4_candidatas_traza (run_id, etapa, resultado);

create table if not exists test.v4_candidatas_traza (
  run_id uuid not null references test.v4_pipeline_runs(id) on delete cascade,
  candidata_id uuid not null references public.candidatas_raw(id) on delete cascade,
  etapa text not null check (etapa in ('preseleccion', 'juez', 'auditor')),
  resultado text not null check (resultado in ('continua', 'entra', 'descarta')),
  motivo text not null,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, candidata_id, etapa)
);

create index if not exists test_v4_candidatas_traza_run_etapa_idx
  on test.v4_candidatas_traza (run_id, etapa, resultado);

alter table public.candidatas_veredicto add column if not exists motivo text;
alter table test.v4_candidatas_veredicto add column if not exists motivo text;

comment on table public.v4_candidatas_traza is
  'Bitacora v4 de una corrida publica: cada candidata materializada conserva etapa, resultado y motivo.';
comment on table test.v4_candidatas_traza is
  'Bitacora aislada de una corrida test; nunca se usa para envios ni modifica datos publicos.';

-- La escritura publica llega por REST directo a candidatas_veredicto. El
-- trigger evita que una futura variante del workflow se olvide de trazar A2.
create or replace function public.v4_trazar_veredicto_publico()
returns trigger
language plpgsql
security definer
set search_path to public
as $function$
declare
  v_run_id uuid;
  v_motivo text;
begin
  select id into v_run_id
  from public.pipeline_runs
  where client_id = new.client_id
    and fecha = new.fecha
    and modo = new.modo
  order by arranco_at desc
  limit 1;

  if v_run_id is null then
    return new;
  end if;

  v_motivo := coalesce(
    nullif(btrim(new.motivo), ''),
    nullif(btrim(new.motivo_forzada), ''),
    case when new.entra then 'A2 aprobó la nota para el clipping'
         else 'A2 descartó la nota sin devolver motivo' end
  );

  insert into public.v4_candidatas_traza (
    run_id, candidata_id, etapa, resultado, motivo, detalle, updated_at
  ) values (
    v_run_id, new.candidata_id, 'juez',
    case when new.entra then 'entra' else 'descarta' end,
    v_motivo,
    jsonb_strip_nulls(jsonb_build_object(
      'agente', new.agente,
      'confianza', new.confianza,
      'forzada', new.forzada,
      'fecha_confiable', new.fecha_confiable,
      'motivo_forzada', new.motivo_forzada
    )), now()
  ) on conflict (run_id, candidata_id, etapa) do update
    set resultado = excluded.resultado,
        motivo = excluded.motivo,
        detalle = excluded.detalle,
        updated_at = now();
  return new;
end;
$function$;

drop trigger if exists v4_trazar_veredicto_publico on public.candidatas_veredicto;
create trigger v4_trazar_veredicto_publico
after insert or update of entra, seccion, confianza, forzada, motivo_forzada, motivo, agente, fecha_confiable
on public.candidatas_veredicto
for each row execute function public.v4_trazar_veredicto_publico();

-- Se conserva el comportamiento actual; solo agrega la traza de que la nota
-- superó la preselección y entró al pool de esta corrida.
create or replace function public.v4_materializar_candidatas(p_run_id uuid, p_tope integer default null)
returns jsonb
language plpgsql security definer
set search_path to public
set statement_timeout to '120s'
as $function$
declare
  v_run public.pipeline_runs%rowtype;
  v_nuevas integer := 0;
  v_total bigint := 0;
begin
  select * into v_run from public.pipeline_runs where id = p_run_id;
  if not found then raise exception 'pipeline_run no existe: %', p_run_id using errcode = '22023'; end if;
  if v_run.pool_materializado_at is null then
    insert into public.pipeline_run_candidatas (run_id, candidata_id, orden, es_prioritaria)
    select p_run_id, x.candidata_id, x.orden, x.es_prioritaria
    from (
      select q.candidata_id, q.es_prioritaria,
        row_number() over (order by q.es_prioritaria desc, q.fecha_pub desc nulls last, q.candidata_id) as orden
      from (
        select q.candidata_id, q.es_prioritaria, q.fecha_pub
        from public.v4_candidatas_aceptadas_operativo(v_run.client_id, v_run.fecha) q
        union
        select c.id, true, c.fecha_pub
        from public.candidatas_raw c
        where c.fecha between v_run.fecha - 1 and v_run.fecha
          and c.fecha_pub is null
          and c.capturado_at >= public.v4_corte_cliente_art(v_run.client_id, v_run.fecha) - interval '24 hours'
          and c.capturado_at < public.v4_corte_cliente_art(v_run.client_id, v_run.fecha)
          and (
            exists (select 1 from public.medios_suscripcion s join public.medios_fuentes f on f.id = s.fuente_id and f.activa
                    where s.client_id = v_run.client_id and s.fuente_id = c.fuente_id and coalesce(s.bloqueado, false) = false
                      and (s.prioritario or s.tier is not null))
            or exists (select 1 from public.google_alerts ga where ga.id = c.alerta_id and ga.client_id = v_run.client_id and ga.activa)
          )
          and not exists (select 1 from public.notas_historico_url h where h.client_id = v_run.client_id and h.url_norm = c.url_canonica
                            and h.primera_vez_fecha >= v_run.fecha - 30)
      ) q
    ) x
    where p_tope is null or x.orden <= greatest(1, p_tope)
    on conflict do nothing;
    get diagnostics v_nuevas = row_count;

    insert into public.v4_candidatas_traza (run_id, candidata_id, etapa, resultado, motivo, detalle, updated_at)
    select p_run_id, pc.candidata_id, 'preseleccion', 'continua',
      'Superó los filtros previos y quedó en el pool para A1/A2',
      jsonb_build_object('orden', pc.orden, 'prioritaria', pc.es_prioritaria, 'modo', v_run.modo), now()
    from public.pipeline_run_candidatas pc
    where pc.run_id = p_run_id
    on conflict (run_id, candidata_id, etapa) do update
      set resultado = excluded.resultado, motivo = excluded.motivo, detalle = excluded.detalle, updated_at = now();

    select count(*) into v_total from public.pipeline_run_candidatas where run_id = p_run_id;
    update public.pipeline_runs set pool_materializado_at=now(),pool_total=v_total,pool_es_muestra=p_tope is not null where id=p_run_id;
  end if;
  select coalesce(pool_total,0) into v_total from public.pipeline_runs where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'client_id',v_run.client_id,'fecha',v_run.fecha,
    'modo',v_run.modo,'candidatas_nuevas',v_nuevas,'candidatas',v_total,
    'candidatas_es_muestra',coalesce((select pool_es_muestra from public.pipeline_runs where id=p_run_id),false));
end;
$function$;

create or replace function public.v4_test_materializar_candidatas(p_run_id uuid, p_tope integer default null)
returns jsonb
language plpgsql security definer
set search_path to test, public
set statement_timeout to '120s'
as $function$
declare
  v_run test.v4_pipeline_runs%rowtype;
  v_nuevas integer := 0;
  v_total bigint := 0;
begin
  select * into v_run from test.v4_pipeline_runs where id=p_run_id for update;
  if not found then raise exception 'corrida test inexistente: %', p_run_id using errcode='22023'; end if;
  if v_run.pool_materializado_at is null then
    insert into test.v4_pipeline_run_candidatas(run_id,candidata_id,orden,es_prioritaria)
    select p_run_id,x.candidata_id,x.orden,x.es_prioritaria
    from (
      select q.candidata_id,q.es_prioritaria,
        row_number() over(order by q.es_prioritaria desc,q.fecha_pub desc nulls last,q.candidata_id) as orden
      from public.v4_candidatas_aceptadas_operativo(v_run.client_id,v_run.fecha,false) q
    ) x
    where p_tope is null or x.orden <= greatest(1,p_tope)
    on conflict do nothing;
    get diagnostics v_nuevas = row_count;

    insert into test.v4_candidatas_traza (run_id, candidata_id, etapa, resultado, motivo, detalle, updated_at)
    select p_run_id, pc.candidata_id, 'preseleccion', 'continua',
      'Superó los filtros previos y quedó en el pool de prueba para A1/A2',
      jsonb_build_object('orden', pc.orden, 'prioritaria', pc.es_prioritaria, 'modo', 'test'), now()
    from test.v4_pipeline_run_candidatas pc where pc.run_id = p_run_id
    on conflict (run_id, candidata_id, etapa) do update
      set resultado = excluded.resultado, motivo = excluded.motivo, detalle = excluded.detalle, updated_at = now();

    select count(*) into v_total from test.v4_pipeline_run_candidatas where run_id=p_run_id;
    update test.v4_pipeline_runs set pool_materializado_at=now(),pool_total=v_total,pool_es_muestra=p_tope is not null where id=p_run_id;
  else
    select coalesce(pool_total,0) into v_total from test.v4_pipeline_runs where id=p_run_id;
  end if;
  return jsonb_build_object('run_id',p_run_id,'client_id',v_run.client_id,'fecha',v_run.fecha,'modo','test',
    'candidatas_nuevas',v_nuevas,'candidatas',v_total,'candidatas_es_muestra',p_tope is not null,
    'ignora_historial_publico',true);
end;
$function$;

create or replace function public.v4_test_guardar_veredictos(p_run_id uuid, p_filas jsonb)
returns jsonb
language plpgsql security definer
set search_path to test, public
as $function$
declare v_run test.v4_pipeline_runs%rowtype; v_guardadas integer := 0;
begin
  select * into v_run from test.v4_pipeline_runs where id = p_run_id;
  if not found then raise exception 'corrida test inexistente: %', p_run_id using errcode = '22023'; end if;
  insert into test.v4_candidatas_veredicto (
    run_id, candidata_id, entra, seccion, confianza, forzada, motivo_forzada, motivo, agente, titulo, snippet, fecha_pub, fecha_confiable
  )
  select p_run_id, x.candidata_id, coalesce(x.entra, false), nullif(x.seccion, ''), x.confianza,
    coalesce(x.forzada, false), x.motivo_forzada, x.motivo, coalesce(nullif(x.agente, ''), 'a2'),
    nullif(x.titulo, ''), nullif(x.snippet, ''), x.fecha_pub, x.fecha_confiable
  from jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb)) as x(
    candidata_id uuid, entra boolean, seccion text, confianza numeric, forzada boolean,
    motivo_forzada text, motivo text, agente text, titulo text, snippet text, fecha_pub timestamptz, fecha_confiable boolean
  ) join test.v4_pipeline_run_candidatas pc on pc.run_id = p_run_id and pc.candidata_id = x.candidata_id
  on conflict (run_id, candidata_id) do update set
    entra=excluded.entra,seccion=excluded.seccion,confianza=excluded.confianza,forzada=excluded.forzada,
    motivo_forzada=excluded.motivo_forzada,motivo=excluded.motivo,agente=excluded.agente,titulo=excluded.titulo,
    snippet=excluded.snippet,fecha_pub=excluded.fecha_pub,fecha_confiable=excluded.fecha_confiable,created_at=now();
  get diagnostics v_guardadas = row_count;

  insert into test.v4_candidatas_traza (run_id, candidata_id, etapa, resultado, motivo, detalle, updated_at)
  select v.run_id, v.candidata_id, 'juez', case when v.entra then 'entra' else 'descarta' end,
    coalesce(nullif(btrim(v.motivo), ''), nullif(btrim(v.motivo_forzada), ''),
             case when v.entra then 'A2 aprobó la nota para el clipping de prueba' else 'A2 descartó la nota sin devolver motivo' end),
    jsonb_strip_nulls(jsonb_build_object('agente',v.agente,'confianza',v.confianza,'forzada',v.forzada,
      'fecha_confiable',v.fecha_confiable,'motivo_forzada',v.motivo_forzada)), now()
  from test.v4_candidatas_veredicto v where v.run_id = p_run_id
  on conflict (run_id, candidata_id, etapa) do update set
    resultado=excluded.resultado,motivo=excluded.motivo,detalle=excluded.detalle,updated_at=now();
  return jsonb_build_object('run_id', p_run_id, 'guardadas', v_guardadas);
end;
$function$;

-- Los prompts vigentes pasan a v3 sin editar el histórico. La restricción de
-- un solo prompt vigente exige hacerlo cliente por cliente: primero se apaga
-- el anterior y recién después se crea el nuevo.
do $prompts$
declare r record;
begin
  for r in
    select distinct on (client_id) id, client_id, version, contenido
    from public.client_prompts
    where vigente
    order by client_id, version desc
  loop
    update public.client_prompts set vigente=false where id=r.id;
    insert into public.client_prompts (client_id, version, contenido, vigente_desde, vigente)
    values (
      r.client_id, r.version + 1,
      r.contenido || E'\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nADENDA v3 — MOTIVO AUDITABLE\n\nEsta adenda complementa ADENDA v2. Cada objeto de `notas` DEBE incluir `motivo`. Si `entra` es false, escribí una sola frase concreta explicando por qué se descarta (por ejemplo: "Nota centrada en Chile sin ángulo argentino" o "No guarda relación con la agenda del cliente"). Si `entra` es true, `motivo` puede ser null. No uses frases vagas como "no relevante" sin aclarar el tema.\n\nFORMATO FINAL\n{\"notas\":[{\"id\":123,\"entra\":true,\"seccion\":\"Turismo\",\"confianza\":0.92,\"motivo\":null},{\"id\":124,\"entra\":false,\"seccion\":null,\"confianza\":0.88,\"motivo\":\"No guarda relación con la agenda del cliente\"}]}\n',
      now(), true
    );
  end loop;
end;
$prompts$;

-- La retención existente borra candidatas_raw y corridas test, ambas con
-- cascade hacia estas tablas: la bitácora queda, como máximo, 48 h junto al
-- material operativo de la corrida.
grant execute on function public.v4_test_materializar_candidatas(uuid, integer) to anon, authenticated, service_role;
grant execute on function public.v4_test_guardar_veredictos(uuid, jsonb) to anon, authenticated, service_role;
