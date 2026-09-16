-- [W0.20] `clipping_v4_json` — leer el clipping v4 GUARDADO con la forma de armar_clipping()
--
-- Runbook: docs/pipeline-v4/roadmap-webapp-v4.md §3.6, Paso 4, punto 3.
--
-- POR QUÉ EXISTE
-- Hoy `wf/armado-cliente` arma el mail de prueba llamando a `v4_test_armar_clipping()` directo.
-- La plataforma, en cambio, va a leer lo que guardó `import_clipping_v4()`. Son dos caminos con
-- dedups distintos: **el mail y la plataforma pueden divergir**, que es exactamente el riesgo de
-- §2.2 del roadmap. La regla del pipeline es *"primero se guarda, después se manda leyendo lo
-- guardado"*, y el workflow no la cumplía.
--
-- Esta función es el "leyendo lo guardado". Devuelve **las mismas claves** que armar_clipping(),
-- así que el nodo Code que construye el HTML del mail **no se modifica**: sólo cambia de dónde
-- viene el JSON que consume.
--
-- DIFERENCIAS ESPERADAS CONTRA armar_clipping(), y por qué no son errores
--   - Incluye las notas del equipo (`origen <> 'n8n'`): precarga y altas manuales. armar_clipping
--     no las conoce. Es el punto: el mail tiene que mostrar lo que el equipo va a ver.
--   - `sin_valorizar` puede ser mayor, porque esas notas del equipo no traen ad_value.
--   - Las secciones vacías no aparecen: si no quedó ninguna nota, no hay fila que agrupar.
--
-- ORDEN DE SECCIONES
-- Sale de `min(orden)` de sus notas. Es fiel porque import_clipping_v4 numera global y
-- secuencialmente recorriendo las secciones en orden.

create or replace function public.clipping_v4_json(
  p_clipping_id uuid,
  p_destino     text default 'test'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_res jsonb;
begin
  if p_destino is null or p_destino not in ('test') then
    raise exception 'destino no permitido: %. Solo test hasta el Paso 7', p_destino
      using errcode = 'invalid_parameter_value';
  end if;

  select jsonb_build_object(
    'client_id',      c.client_id,
    'fecha',          c.fecha,
    'modo',           'test',
    'clipping_id',    c.id,
    'run_id',         c.run_id,
    'nivel_salida',   c.nivel_salida,
    'nivel_motivo',   c.nivel_motivo,
    'origen_json',    'clipping_v4_json (lo guardado)',
    'total_notas',    coalesce(tot.n, 0),
    'ad_value_total', coalesce(tot.ad, 0),
    'sin_valorizar',  coalesce(tot.sv, 0),
    'forzadas',       coalesce(tot.fz, 0),
    'secciones',      coalesce(sec.arr, '[]'::jsonb)
  )
  into v_res
  from test.clippings_v4 c
  left join lateral (
    select count(*) n,
           coalesce(sum(n2.ad_value),0) ad,
           count(*) filter (where n2.ad_value is null) sv,
           count(*) filter (where n2.forzada) fz
    from test.notes_v4 n2 where n2.clipping_id = c.id and n2.incluida
  ) tot on true
  left join lateral (
    select jsonb_agg(x.obj order by x.orden_seccion) as arr
    from (
      select min(n3.orden) as orden_seccion,
             jsonb_build_object(
               'nombre',           coalesce(n3.seccion, '(sin seccion)'),
               'orden',            row_number() over (order by min(n3.orden)),
               'es_exclusiva',     coalesce(bool_or(s.es_exclusiva), false),
               'muestra_ad_value', coalesce(bool_or(s.muestra_ad_value), false),
               'cantidad',         count(*),
               'ad_value',         coalesce(sum(n3.ad_value),0),
               'sin_valorizar',    count(*) filter (where n3.ad_value is null),
               'notas',            jsonb_agg(jsonb_build_object(
                                     'candidata_id',    n3.candidata_id,
                                     'titulo',          n3.titulo,
                                     'snippet',         n3.snippet,
                                     'url',             n3.url,
                                     'medio',           n3.medio,
                                     'dominio',         n3.dominio,
                                     'fecha_pub',       n3.pub_date,
                                     'fecha_confiable', n3.fecha_confiable,
                                     'tier',            n3.tier,
                                     'alcance',         n3.alcance,
                                     'ad_value',        n3.ad_value,
                                     'confianza',       n3.confianza,
                                     'forzada',         n3.forzada,
                                     'motivo_forzada',  n3.motivo_forzada,
                                     'orden',           n3.orden,
                                     'origen',          n3.origen
                                   ) order by n3.orden)
             ) as obj
      from test.notes_v4 n3
      left join public.secciones s
        on s.client_id = c.client_id and s.nombre = n3.seccion
      where n3.clipping_id = c.id and n3.incluida
      group by coalesce(n3.seccion, '(sin seccion)')
    ) x
  ) sec on true
  where c.id = p_clipping_id;

  if v_res is null then
    raise exception 'no existe el clipping v4 %', p_clipping_id using errcode = 'no_data_found';
  end if;

  return v_res;
end;
$fn$;

revoke all on function public.clipping_v4_json(uuid, text) from public, anon, authenticated;
grant execute on function public.clipping_v4_json(uuid, text) to service_role;

comment on function public.clipping_v4_json(uuid, text) is
  '[W0.20] Devuelve el clipping v4 GUARDADO con la misma forma que armar_clipping(), para que el mail se arme leyendo lo guardado y no un JSON paralelo.';

-- ---------------------------------------------------------------------------
-- VERIFICADO 15/09 sobre la fixture de BMS
--   total_notas 6 · ad_value_total 4300 · nivel_salida 0
--   "Notas Exclusivas"   orden 1 · 3 notas · es_exclusiva true  · muestra_ad_value true
--   "Noticias del Sector" orden 2 · 3 notas · es_exclusiva false · muestra_ad_value false
--   (los dos flags cruzan bien contra public.secciones del cliente BMS real)
-- ---------------------------------------------------------------------------
