-- [W0.27] La foto de Actividad se puede recalcular sobre una corrida ya vista.
-- Una fuente repetida no debe impedir actualizar el panel de prueba.
begin;

do $do$
declare definicion text;
begin
  select pg_get_functiondef('public.v4_test_snapshot_actividad(uuid)'::regprocedure)
    into definicion;

  if position('on conflict (run_id,fuente_id) do update' in lower(definicion)) = 0 then
    if position('  ) l on true;' in definicion) = 0 then
      raise exception 'No se encontro el cierre esperado del snapshot; no se modifica la funcion.';
    end if;
    definicion := replace(
      definicion,
      '  ) l on true;',
      '  ) l on true
  on conflict (run_id,fuente_id) do update set
    dominio_norm=excluded.dominio_norm, ok=excluded.ok, outcome=excluded.outcome,
    http_status=excluded.http_status, diagnostico=excluded.diagnostico,
    articulos=excluded.articulos, ms=excluded.ms, fetched_at=excluded.fetched_at;'
    );
    execute definicion;
  end if;
end;
$do$;

commit;
