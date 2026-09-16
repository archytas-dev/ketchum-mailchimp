-- Agrega al pool persistido las notas recientes sin fecha de fuentes
-- suscriptas/prioritarias. La paginacion existente funciona como cursor: A1
-- las abre y la compuerta final decide si la fecha recuperada entra.
do $migracion$
declare
  definicion text;
  viejo text := '      from public.v4_candidatas_aceptadas_operativo(v_run.client_id, v_run.fecha) q';
  nuevo text := E'      from (\n        select q.candidata_id, q.es_prioritaria, q.fecha_pub\n        from public.v4_candidatas_aceptadas_operativo(v_run.client_id, v_run.fecha) q\n        union\n        select c.id, true, c.fecha_pub\n        from public.candidatas_raw c\n        where c.fecha between v_run.fecha - 1 and v_run.fecha\n          and c.fecha_pub is null\n          and c.capturado_at >= public.v4_corte_cliente_art(v_run.client_id, v_run.fecha) - interval ''24 hours''\n          and c.capturado_at < public.v4_corte_cliente_art(v_run.client_id, v_run.fecha)\n          and (\n            exists (\n              select 1 from public.medios_suscripcion s\n              join public.medios_fuentes f on f.id = s.fuente_id and f.activa\n              where s.client_id = v_run.client_id and s.fuente_id = c.fuente_id\n                and coalesce(s.bloqueado, false) = false\n                and (s.prioritario or s.tier is not null)\n            )\n            or exists (\n              select 1 from public.google_alerts ga\n              where ga.id = c.alerta_id and ga.client_id = v_run.client_id and ga.activa\n            )\n          )\n          and not exists (\n            select 1 from public.notas_historico_url h\n            where h.client_id = v_run.client_id and h.url_norm = c.url_canonica\n              and h.primera_vez_fecha >= v_run.fecha - 30\n          )\n      ) q';
begin
  select pg_get_functiondef('public.v4_materializar_candidatas(uuid,integer)'::regprocedure) into definicion;
  if position(viejo in definicion) = 0 then
    raise exception 'No coincide materializar pool; no se reemplaza a ciegas.';
  end if;
  definicion := replace(definicion, viejo, nuevo);
  execute definicion;
end;
$migracion$;
