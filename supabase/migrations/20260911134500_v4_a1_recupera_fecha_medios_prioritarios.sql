-- Los feeds/listas de varios medios monitoreados o con tier no traen fecha,
-- aunque la nota individual sí declara article:published_time, JSON-LD o time.
-- Deben llegar a A1 para recuperar esa fecha. La compuerta final de A1 ya
-- bloquea la nota si resulta vieja o futura; A2 conserva la decisión editorial.
do $migracion$
declare
  definicion text;
  marca_vieja text := 'bool_or(mon.dominio_norm is not null) as fuente_monitoreada';
  marca_nueva text := 'bool_or(coalesce(s.prioritario, false) or mon.dominio_norm is not null) as fuente_monitoreada';
  relevancia_vieja text := '    )) as tiene_relevancia';
  relevancia_nueva text := E'    ) or (\n      (not t.fecha_confiable or t.fecha_pub is null)\n      and (t.fuente_monitoreada or t.fuente_tier is not null)\n    )) as tiene_relevancia';
begin
  select pg_get_functiondef('public.v4_candidatas_aceptadas_rapido(uuid,date,boolean)'::regprocedure)
  into definicion;

  if definicion is null or position(marca_vieja in definicion) = 0 then
    raise exception 'No se encontro la marca de fuente esperada; no se reemplaza a ciegas.';
  end if;
  if position(relevancia_vieja in definicion) = 0 then
    raise exception 'No se encontro el filtro de relevancia esperado; no se reemplaza a ciegas.';
  end if;

  definicion := replace(definicion, marca_vieja, marca_nueva);
  definicion := replace(definicion, relevancia_vieja, relevancia_nueva);
  execute definicion;
end;
$migracion$;
