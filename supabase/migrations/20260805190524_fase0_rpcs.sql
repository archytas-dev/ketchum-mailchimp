create or replace function get_config_clipping(p_slug text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'client_id',  c.id,
    'slug',       c.slug,
    'keywords',   (select coalesce(jsonb_agg(to_jsonb(k) - 'client_id'), '[]'::jsonb)
                   from kw_keywords k where k.client_id=c.id and k.activa),
    'medios',     (select coalesce(jsonb_agg(to_jsonb(m) - 'client_id'), '[]'::jsonb)
                   from medios m where m.client_id=c.id and m.activo),
    'alerts',     (select coalesce(jsonb_agg(to_jsonb(a) - 'client_id'), '[]'::jsonb)
                   from google_alerts a where a.client_id=c.id and a.activa),
    'gacetillas', (select coalesce(jsonb_agg(to_jsonb(g) - 'client_id'), '[]'::jsonb)
                   from gacetillas g where g.client_id=c.id and g.estado='BUSCANDO'),
    'tiers',      (select coalesce(jsonb_object_agg(lower(t.dominio),
                     jsonb_build_object('tier',t.tier,'alcance',t.alcance,
                       'ad_value', coalesce(t.ad_value,
                         (select d.ad_value from tier_defaults d
                          where d.client_id=c.id and d.tier=t.tier)))), '{}'::jsonb)
                   from tiers t where t.client_id=c.id),
    'secciones',  (select coalesce(jsonb_agg(to_jsonb(s) - 'client_id' order by s.orden), '[]'::jsonb)
                   from secciones s where s.client_id=c.id and s.activa)
  ) from clients c where c.slug = p_slug;
$$;

create or replace function log_run_stats(
  p_slug text,
  p_stats jsonb,
  p_descartadas jsonb default '[]'::jsonb,
  p_bloqueados jsonb default '[]'::jsonb
)
returns void language plpgsql security definer set search_path to 'public' as $$
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
    ia_chunks_total, ia_chunks_error, costo_openai_usd, duracion_ms
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
    (p_stats->>'duracion_ms')::int
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
$$;

-- Ambas RPC son solo para n8n (service_role), no para la app
revoke execute on function get_config_clipping(text) from public, anon, authenticated;
grant execute on function get_config_clipping(text) to service_role;

revoke execute on function log_run_stats(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function log_run_stats(text, jsonb, jsonb, jsonb) to service_role;

