-- El rescate de una fuente monitoreada solo salta la compuerta de keyword.
-- No convierte toda la fuente en contenido obligatorio: A2 tiene que poder
-- descartar deportes, policiales, sociedad y demás notas irrelevantes.
-- Las marcas explícitas del cliente siguen siendo prioritarias/forzadas.

do $rescate$
declare
  definicion text;
  viejo text := '(a.fuente_monitoreada or a.tiene_marca_titulo) as es_prioritaria,';
  nuevo text := 'a.tiene_marca_titulo as es_prioritaria,';
begin
  select pg_get_functiondef(
    'public.v4_candidatas_aceptadas_operativo(uuid,date,boolean)'::regprocedure
  ) into definicion;

  if position(viejo in definicion) = 0 then
    raise exception 'No coincide la función de rescate; no se modifica a ciegas.';
  end if;

  execute replace(definicion, viejo, nuevo);
end;
$rescate$;

comment on function public.v4_candidatas_aceptadas_operativo(uuid, date, boolean) is
  'Pool operativo: fuentes monitoreadas pueden llegar al A2 sin keyword; solo las marcas explícitas son prioritarias y forzadas.';
