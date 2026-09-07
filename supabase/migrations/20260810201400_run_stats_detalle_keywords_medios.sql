alter table run_stats
  add column keywords_detalle jsonb,
  add column medios_detalle jsonb;

-- create or replace NO alcanza acá: 2 params nuevos cambian la firma, así que Postgres crearía
-- un segundo overload en vez de reemplazar el existente (visto en carne propia -- quedaron las
-- dos versiones coexistiendo hasta que se detectó por una llamada ambigua). Hay que borrar la
-- firma vieja de 4 params explícitamente antes de crear la de 6.
drop function if exists log_run_stats(text, jsonb, jsonb, jsonb);

create or replace function log_run_stats(
  p_slug text,
  p_stats jsonb,
  p_descartadas jsonb default '[]'::jsonb,
  p_bloqueados jsonb default '[]'::jsonb,
  p_keywords_detalle jsonb default null,
  p_medios_detalle jsonb default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client_id uuid;
begin
  select id into v_client_id from clients where slug = p_slug;
  if v_client_id is null then
    raise exception 'Cliente no encontrado: %', p_slug;
  end if;

  insert into run_stats (
    client_id, fecha, n8n_run_id, trigger_tipo,
    medios_intentados, medios_ok, medios_sin_resultado, medios_bloqueados,
    keywords_totales, keywords_con_match,
    notas_fetched, notas_post_dedup, notas_post_ia, notas_enviadas,
    ia_chunks_total, ia_chunks_error, costo_openai_usd, duracion_ms,
    keywords_detalle, medios_detalle
  )
  values (
    v_client_id,
    (p_stats->>'fecha')::date,
    p_stats->>'n8n_run_id',
    p_stats->>'trigger_tipo',
    (p_stats->>'medios_intentados')::int,
    (p_stats->>'medios_ok')::int,
    (p_stats->>'medios_sin_resultado')::int,
    (p_stats->>'medios_bloqueados')::int,
    (p_stats->>'keywords_totales')::int,
    (p_stats->>'keywords_con_match')::int,
    (p_stats->>'notas_fetched')::int,
    (p_stats->>'notas_post_dedup')::int,
    (p_stats->>'notas_post_ia')::int,
    (p_stats->>'notas_enviadas')::int,
    (p_stats->>'ia_chunks_total')::int,
    (p_stats->>'ia_chunks_error')::int,
    (p_stats->>'costo_openai_usd')::numeric,
    (p_stats->>'duracion_ms')::int,
    p_keywords_detalle,
    p_medios_detalle
  )
  on conflict (client_id, fecha, n8n_run_id) do nothing;

  insert into notas_descartadas (client_id, fecha, n8n_run_id, titulo, url, medio, dominio, fase, motivo, score)
  select
    v_client_id,
    (p_stats->>'fecha')::date,
    p_stats->>'n8n_run_id',
    d->>'titulo', d->>'url', d->>'medio', d->>'dominio',
    d->>'fase', d->>'motivo',
    (d->>'score')::numeric
  from jsonb_array_elements(coalesce(p_descartadas, '[]'::jsonb)) d;

  insert into medios_bloqueados (client_id, dominio, motivo, http_status)
  select v_client_id, b->>'dominio', b->>'motivo', (b->>'http_status')::int
  from jsonb_array_elements(coalesce(p_bloqueados, '[]'::jsonb)) b
  on conflict (client_id, lower(dominio)) do update set
    motivo = excluded.motivo,
    http_status = excluded.http_status,
    intentos = medios_bloqueados.intentos + 1,
    ultima_vez = now(),
    resuelto = false;
end;
$function$;

create or replace function get_actividad_resumen(p_client_id uuid, p_dias int default 14)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_result jsonb;
begin
  if not has_client_access(p_client_id) then
    raise exception 'Sin acceso a este cliente';
  end if;

  -- Un cliente puede tener mas de una fila por dia (corridas manuales de prueba,
  -- reintentos). Nos quedamos con la mas reciente por fecha, no con la suma --
  -- sumar duplicaria el embudo si alguien reejecuto el workflow a mano el mismo dia.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.fecha desc), '[]'::jsonb)
  into v_result
  from (
    select distinct on (fecha)
      fecha, medios_intentados, medios_ok, medios_sin_resultado,
      notas_fetched, notas_post_dedup, notas_post_ia, notas_enviadas,
      keywords_totales, keywords_con_match, keywords_detalle, medios_detalle
    from run_stats
    where client_id = p_client_id
      and fecha >= current_date - p_dias
    order by fecha desc, created_at desc
  ) r;

  return v_result;
end;
$function$;
