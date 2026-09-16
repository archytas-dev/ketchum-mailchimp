-- Ampliamos la ventana operativa para que los tests puedan consultar dos días
-- completos. La función base ya está aplicada; acá sólo actualizamos su valor
-- por defecto y dejamos que el workflow también lo envíe explícitamente.
do $retention$
declare
  v_definicion text;
begin
  select pg_get_functiondef(
    'public.v4_purgar_datos_operativos(interval,integer,interval)'::regprocedure
  ) into v_definicion;

  if v_definicion is null
     or position('DEFAULT ''24:00:00''::interval' in v_definicion) = 0 then
    raise exception 'No se encontró la definición esperada de v4_purgar_datos_operativos';
  end if;

  execute replace(
    v_definicion,
    'DEFAULT ''24:00:00''::interval',
    'DEFAULT ''48:00:00''::interval'
  );
end;
$retention$;

comment on function public.v4_purgar_datos_operativos(interval, integer, interval)
  is 'Limpia material operativo v4 anterior a 48 horas; conserva enviados e historial público.';
