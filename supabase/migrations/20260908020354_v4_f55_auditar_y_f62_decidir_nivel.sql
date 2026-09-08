-- [F5.5] La auditoria y [F6.2] el nivel de salida.
--
-- Los chequeos van en SQL y no en el agente por la misma razon que las reglas
-- de la Fase 4: son verificables, se explican solos y no cuestan un token.
-- El A3 en n8n se queda con lo que SI necesita salir a la red (muestrear links).

create or replace function public.auditar_clipping(
  p_client_id uuid,
  p_fecha date default v4_hoy()
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with cl as (select armar_clipping(p_client_id, p_fecha) as j),
notas as (
  select n->>'candidata_id' as candidata_id,
         n->>'titulo'  as titulo,
         n->>'url'     as url,
         n->>'dominio' as dominio,
         s->>'nombre'  as seccion,
         (n->>'ad_value')  is null as sin_valor,
         (n->>'forzada')::boolean  as forzada,
         (n->>'confianza')::numeric as confianza
  from cl, jsonb_array_elements(cl.j->'secciones') s,
       jsonb_array_elements(s->'notas') n
),
-- DUROS: sacan la nota, no frenan el clipping. El envio sale igual, con una
-- nota menos; frenar todo por una nota rota es peor que mandarla incompleta.
duros as (
  select candidata_id, titulo, seccion, 'sin_url' as motivo from notas where url is null or url = ''
  union all
  select candidata_id, titulo, seccion, 'titulo_vacio' from notas where titulo is null or length(trim(titulo)) < 10
  union all
  select candidata_id, titulo, seccion, 'repetida_en_el_clipping' from (
    select candidata_id, titulo, seccion,
           row_number() over (partition by lower(url) order by candidata_id) as rn
    from notas where url is not null and url <> '') d where rn > 1
  union all
  select n.candidata_id, n.titulo, n.seccion, 'dominio_bloqueado'
  from notas n join medios_bloqueados_global b
    on b.activo and lower(n.dominio) = lower(b.dominio)
),
-- BLANDOS: avisan, no tocan nada. Que una seccion venga vacia puede ser normal
-- un martes y una senal un lunes; el que lee decide.
blandos as (
  select 'seccion_vacia' as aviso, s->>'nombre' as detalle
  from cl, jsonb_array_elements(cl.j->'secciones') s
  where (s->>'cantidad')::int = 0
  union all
  select 'clipping_chico', 'solo ' || (select count(*)::text from notas) || ' notas'
  where (select count(*) from notas) between 1 and 4
  union all
  select 'clipping_vacio', 'ninguna nota supero el filtro'
  where (select count(*) from notas) = 0
  union all
  select 'muchas_forzadas', (select count(*)::text from notas where forzada) || ' de ' || (select count(*)::text from notas)
  where (select count(*) from notas where forzada) > greatest(1, (select count(*) from notas) / 4)
  union all
  select 'muchas_sin_valorizar', (select count(*)::text from notas where sin_valor) || ' de ' || (select count(*)::text from notas)
  where (select count(*) from notas where sin_valor) > (select count(*) from notas) / 2
  union all
  select 'confianza_baja', (select count(*)::text from notas where confianza < 0.70) || ' notas con confianza < 0,70'
  where (select count(*) from notas where confianza < 0.70) > 0
),
-- REPESCA: descartes del A2 con poca confianza. NO se reincorporan solos —
-- se listan para que alguien mire. Un descarte dudoso no es un acierto oculto.
repesca as (
  select v.candidata_id, c.titulo, v.confianza
  from candidatas_veredicto v join candidatas_raw c on c.id = v.candidata_id
  where v.client_id = p_client_id and v.fecha = p_fecha
    and not v.entra and v.confianza is not null and v.confianza < 0.70
  order by v.confianza asc limit 20
)
select jsonb_build_object(
  'client_id', p_client_id, 'fecha', p_fecha,
  'notas', (select count(*) from notas),
  'a_sacar', coalesce((select jsonb_agg(jsonb_build_object(
      'candidata_id', candidata_id, 'titulo', titulo, 'seccion', seccion, 'motivo', motivo))
    from duros), '[]'::jsonb),
  'avisos', coalesce((select jsonb_agg(jsonb_build_object('aviso', aviso, 'detalle', detalle))
    from blandos), '[]'::jsonb),
  'repesca', coalesce((select jsonb_agg(jsonb_build_object(
      'candidata_id', candidata_id, 'titulo', titulo, 'confianza', confianza))
    from repesca), '[]'::jsonb),
  'notas_finales', (select count(*) from notas) - (select count(distinct candidata_id) from duros)
);
$$;

comment on function public.auditar_clipping(uuid, date) is
  'Chequea el clipping entero. Los duros sacan la nota pero NO frenan el envio; los blandos solo avisan; la repesca lista descartes dudosos para que alguien mire, sin reincorporarlos solos.';

-- ---------------------------------------------------------------------------
-- [F6.2] Con que se sale. NUNCA devuelve "no salgo": el principio del design
-- doc es que el envio puede salir peor, nunca puede no salir.
-- ---------------------------------------------------------------------------
create or replace function public.decidir_nivel(
  p_client_id uuid,
  p_fecha date default v4_hoy()
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with a as (select auditar_clipping(p_client_id, p_fecha) as j),
v as (
  select count(*) filter (where entra) as entran,
         count(*)                      as juzgadas,
         count(*) filter (where forzada) as forzadas
  from candidatas_veredicto
  where client_id = p_client_id and fecha = p_fecha
),
p as (
  select count(*) as candidatas
  from v4_evaluar_candidatas(p_client_id, p_fecha)
  where descartada_por is null
)
select jsonb_build_object(
  'client_id', p_client_id, 'fecha', p_fecha,
  'nivel', case
    -- 3: no hay ni pool. Sale el sobre avisando, que es mejor que el silencio:
    -- un dia sin mail se confunde con un mail que no llego.
    when (select candidatas from p) = 0 then 3
    -- 2: hay candidatas pero el juez no opino. Sale lo que paso las compuertas
    -- deterministicas, sin secciones finas.
    when (select juzgadas from v) = 0 then 2
    -- 1: el juez opino pero no quedo nada, o quedo casi nada.
    when (select entran from v) = 0 then 1
    else 0
  end,
  'motivo', case
    when (select candidatas from p) = 0 then 'sin candidatas: el pool no dio nada para este cliente'
    when (select juzgadas from v) = 0 then 'sin veredictos: el A2 no corrio o fallo entero'
    when (select entran from v) = 0 then 'el juez no dejo pasar ninguna'
    else 'completo'
  end,
  'candidatas', (select candidatas from p),
  'juzgadas',   (select juzgadas from v),
  'entran',     (select entran from v),
  'forzadas',   (select forzadas from v),
  'notas_finales', ((select j from a)->>'notas_finales')::int,
  'avisos',     ((select j from a)->'avisos'),
  -- Siempre sale. La bandera existe para que nadie tenga que preguntarselo.
  'sale', true
);
$$;

comment on function public.decidir_nivel(uuid, date) is
  'Nivel de salida 0-3 segun que etapas anduvieron. NUNCA devuelve "no salgo": el envio puede salir peor, nunca puede no salir. Un dia sin mail se confunde con un mail que no llego.';

grant execute on function public.auditar_clipping(uuid, date) to anon, authenticated, service_role;
grant execute on function public.decidir_nivel(uuid, date) to anon, authenticated, service_role;
