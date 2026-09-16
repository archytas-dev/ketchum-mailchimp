-- Si la misma nota aparece en varios orígenes, conservar primero la fuente
-- monitoreada del cliente; después se aplican prioridad, fecha y captura.
do $dedup$
declare
  definicion text;
  viejo text := 'order by p.es_prioritaria desc, p.fecha_confiable desc, p.fecha_pub desc nulls last, p.capturado_at';
  nuevo text := 'order by p.fuente_monitoreada desc, p.es_prioritaria desc, p.viene_de_alerta desc, p.fecha_confiable desc, p.fecha_pub desc nulls last, p.capturado_at';
begin
  select pg_get_functiondef(
    'public.v4_candidatas_aceptadas_rapido(uuid,date,boolean)'::regprocedure
  ) into definicion;
  if position('order by p.fuente_monitoreada desc' in definicion) = 0 then
    if position(viejo in definicion) = 0 then
      raise exception 'No coincide el orden de deduplicación; no se modifica a ciegas.';
    end if;
    execute replace(definicion, viejo, nuevo);
  end if;
end;
$dedup$;
