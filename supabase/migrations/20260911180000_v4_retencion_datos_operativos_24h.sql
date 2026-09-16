-- v4: retención del material operativo pesado.
--
-- candidatas_raw es un pool temporal: guarda la URL, título y snippet que
-- entraron al proceso, no el artículo completo ni imágenes. Sin una limpieza
-- explícita crecía todos los días y sus índices llegaron a ocupar casi tanto
-- como la tabla.
--
-- Se conserva:
--   * candidatas capturadas en las últimas 24 horas;
--   * pruebas de las últimas 24 horas;
--   * notas ya enviadas (notes, clippings y notas_historico_url).
--
-- notas_historico_url NO se borra: es el historial de repetición de 30 días
-- que usa el armado para no volver a mandar una URL al mismo cliente.

create index if not exists candidatas_raw_capturado_at_idx
  on public.candidatas_raw (capturado_at);

create index if not exists notas_descartadas_created_at_idx
  on public.notas_descartadas (created_at);

create or replace function public.v4_purgar_datos_operativos(
  p_antiguedad interval default interval '24 hours',
  p_max_rows integer default 100000,
  p_logs_antiguedad interval default interval '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path = public, test
set statement_timeout = '120s'
as $function$
declare
  v_corte timestamptz;
  v_corte_logs timestamptz;
  v_lote integer;
  v_borradas bigint;
  v_raw bigint := 0;
  v_descartadas bigint := 0;
  v_logs bigint := 0;
  v_test_runs bigint := 0;
  v_test_descartadas bigint := 0;
  v_test_historial bigint := 0;
  v_test_notes bigint := 0;
  v_test_clippings bigint := 0;
  v_test_reportes bigint := 0;
begin
  if p_antiguedad < interval '1 hour' or p_antiguedad > interval '7 days' then
    raise exception 'p_antiguedad debe estar entre 1 hora y 7 días';
  end if;
  if p_logs_antiguedad < interval '24 hours' or p_logs_antiguedad > interval '30 days' then
    raise exception 'p_logs_antiguedad debe estar entre 24 horas y 30 días';
  end if;
  if coalesce(p_max_rows, 0) < 1 or p_max_rows > 200000 then
    raise exception 'p_max_rows debe estar entre 1 y 200000';
  end if;

  v_corte := now() - p_antiguedad;
  v_corte_logs := now() - p_logs_antiguedad;
  v_lote := least(5000, p_max_rows);

  -- Las corridas de prueba viejas se llevan sus páginas, candidatas y
  -- veredictos en cascada. Las de las últimas 24 horas quedan disponibles
  -- para revisar un test ya terminado.
  delete from test.v4_pipeline_runs
   where arranco_at < v_corte;
  get diagnostics v_test_runs = row_count;

  -- El schema test también contiene copias históricas de las tablas de la v3.
  -- Son datos de ensayo, no son el historial público enviado al cliente.
  delete from test.notas_descartadas where created_at < v_corte;
  get diagnostics v_test_descartadas = row_count;

  delete from test.notas_historico_url where created_at < v_corte;
  get diagnostics v_test_historial = row_count;

  delete from test.notes where created_at < v_corte;
  get diagnostics v_test_notes = row_count;

  delete from test.clippings where created_at < v_corte;
  get diagnostics v_test_clippings = row_count;

  delete from test.reportes where created_at < v_corte;
  get diagnostics v_test_reportes = row_count;

  -- Descartes: se conserva únicamente la ventana que sirve para diagnosticar
  -- el día actual. Se borra por tandas para no armar una transacción enorme.
  loop
    exit when v_descartadas >= p_max_rows;
    delete from public.notas_descartadas d
     where d.id in (
       select x.id
       from public.notas_descartadas x
       where x.created_at < v_corte
       order by x.created_at, x.id
       limit least(v_lote, p_max_rows - v_descartadas)
     );
    get diagnostics v_borradas = row_count;
    v_descartadas := v_descartadas + v_borradas;
    exit when v_borradas = 0;
  end loop;

  -- Pool crudo: el reloj correcto es capturado_at, no fecha (fecha es la fecha
  -- publicada por el medio y puede ser distinta). No se toca una candidata que
  -- todavía esté referenciada por una corrida de las últimas 24 horas.
  loop
    exit when v_raw >= p_max_rows;
    delete from public.candidatas_raw c
     where c.id in (
       select x.id
       from public.candidatas_raw x
       where x.capturado_at < v_corte
         and not exists (
           select 1
           from test.v4_pipeline_run_candidatas pc
           join test.v4_pipeline_runs pr on pr.id = pc.run_id
           where pc.candidata_id = x.id
             and pr.arranco_at >= v_corte
         )
         and not exists (
           select 1
           from public.pipeline_run_candidatas pc
           join public.pipeline_runs pr on pr.id = pc.run_id
           where pc.candidata_id = x.id
             and pr.arranco_at >= v_corte
         )
       order by x.capturado_at, x.id
       limit least(v_lote, p_max_rows - v_raw)
     );
    get diagnostics v_borradas = row_count;
    v_raw := v_raw + v_borradas;
    exit when v_borradas = 0;
  end loop;

  -- fetch_log contiene sólo telemetría (no HTML ni artículos), pero dejamos
  -- siete días para poder investigar una fuente que falló recientemente.
  delete from public.fetch_log
   where ts < v_corte_logs;
  get diagnostics v_logs = row_count;

  return jsonb_build_object(
    'ok', true,
    'corte', v_corte,
    'logs_desde', v_corte_logs,
    'borrado', jsonb_build_object(
      'candidatas_raw', v_raw,
      'notas_descartadas', v_descartadas,
      'fetch_log', v_logs,
      'test_v4_pipeline_runs', v_test_runs,
      'test_notas_descartadas', v_test_descartadas,
      'test_notas_historico_url', v_test_historial,
      'test_notes', v_test_notes,
      'test_clippings', v_test_clippings,
      'test_reportes', v_test_reportes
    ),
    'preservado', jsonb_build_array(
      'candidatas de las últimas 24 horas',
      'corridas test de las últimas 24 horas',
      'notes y clippings enviados',
      'notas_historico_url para deduplicación de 30 días'
    )
  );
end;
$function$;

revoke all on function public.v4_purgar_datos_operativos(interval, integer, interval)
  from public, anon, authenticated;
grant execute on function public.v4_purgar_datos_operativos(interval, integer, interval)
  to service_role;

comment on function public.v4_purgar_datos_operativos(interval, integer, interval)
  is 'Limpia material operativo v4 anterior a la ventana indicada; conserva enviados e historial público.';
