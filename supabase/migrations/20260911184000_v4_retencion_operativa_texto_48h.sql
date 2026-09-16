-- Mantiene alineados los mensajes de diagnóstico del RPC con la ventana real.
do $retention$
declare
  v_definicion text;
begin
  select pg_get_functiondef(
    'public.v4_purgar_datos_operativos(interval,integer,interval)'::regprocedure
  ) into v_definicion;

  if v_definicion is null
     or position('DEFAULT ''48:00:00''::interval' in v_definicion) = 0 then
    raise exception 'La retención de 48 horas no está aplicada';
  end if;

  execute replace(v_definicion, 'últimas 24 horas', 'últimas 48 horas');
end;
$retention$;
