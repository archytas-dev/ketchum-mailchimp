-- Pasar NULL explicito NO usa el default de la funcion.
--
-- armar_clipping(cliente, null) no toma v4_hoy(): toma NULL, y entonces
-- `where fecha = null` no matchea nada. El armado devolvia un clipping vacio
-- sin ningun error, y decidir_nivel reportaba "sin candidatas" con el pool
-- lleno. Visto el 08/09 en la primera corrida de wf/armado-cliente.
--
-- Es la misma familia que el bug de las tres horas: un default que no hace lo
-- que uno cree. Y es peor, porque acá no hay ventana horaria: pasa siempre que
-- el llamador manda el campo vacio, que es lo natural cuando la fecha es
-- opcional en un webhook.
--
-- Se resuelve adentro con coalesce(p_fecha, v4_hoy()), que sirve para los dos
-- casos: omitido y NULL explicito.

create or replace function public.armar_clipping(
  p_client_id uuid,
  p_fecha date default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with param as (select coalesce(p_fecha, v4_hoy()) as fecha),
notas as (
  select v.candidata_id, v.seccion, v.confianza, v.forzada,
         c.titulo, c.snippet, c.url, c.dominio_norm, c.fecha_pub, c.fecha_confiable,
         coalesce(t.ad_value, td.ad_value) as ad_value,
         t.tier, t.alcance, coalesce(t.medio, c.dominio_norm) as medio
  from candidatas_veredicto v
  join candidatas_raw c on c.id = v.candidata_id
  left join tiers t on t.client_id = p_client_id and lower(t.dominio) = lower(c.dominio_norm)
  left join tier_defaults td on td.client_id = p_client_id and td.tier = t.tier
  where v.client_id = p_client_id and v.fecha = (select fecha from param) and v.entra
),
por_seccion as (
  select s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'candidata_id', n.candidata_id, 'titulo', n.titulo, 'snippet', n.snippet,
        'url', n.url, 'medio', n.medio, 'dominio', n.dominio_norm,
        'fecha_pub', n.fecha_pub, 'fecha_confiable', n.fecha_confiable,
        'tier', n.tier, 'alcance', n.alcance, 'ad_value', n.ad_value,
        'confianza', n.confianza, 'forzada', n.forzada)
      order by n.ad_value desc nulls last, n.fecha_pub desc nulls last, n.titulo
    ) filter (where n.candidata_id is not null), '[]'::jsonb) as notas,
    count(n.candidata_id) as cantidad,
    coalesce(sum(n.ad_value), 0) as ad_value_seccion,
    count(*) filter (where n.ad_value is null and n.candidata_id is not null) as sin_valorizar
  from secciones s
  left join notas n on n.seccion = s.nombre
  where s.client_id = p_client_id and s.activa
  group by s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value
)
select jsonb_build_object(
  'client_id', p_client_id, 'fecha', (select fecha from param),
  'total_notas', (select count(*) from notas),
  'ad_value_total', (select coalesce(sum(ad_value), 0) from notas),
  'sin_valorizar', (select count(*) from notas where ad_value is null),
  'forzadas', (select count(*) from notas where forzada),
  'secciones', coalesce((
    select jsonb_agg(jsonb_build_object(
      'nombre', ps.nombre, 'orden', ps.orden,
      'es_exclusiva', ps.es_exclusiva, 'muestra_ad_value', ps.muestra_ad_value,
      'cantidad', ps.cantidad, 'ad_value', ps.ad_value_seccion,
      'sin_valorizar', ps.sin_valorizar, 'notas', ps.notas
    ) order by ps.orden) from por_seccion ps), '[]'::jsonb)
);
$$;

create or replace function public.auditar_clipping(
  p_client_id uuid,
  p_fecha date default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with param as (select coalesce(p_fecha, v4_hoy()) as fecha),
cl as (select armar_clipping(p_client_id, (select fecha from param)) as j),
notas as (
  select n->>'candidata_id' as candidata_id, n->>'titulo' as titulo,
         n->>'url' as url, n->>'dominio' as dominio, s->>'nombre' as seccion,
         (n->>'ad_value') is null as sin_valor,
         (n->>'forzada')::boolean as forzada,
         (n->>'confianza')::numeric as confianza
  from cl, jsonb_array_elements(cl.j->'secciones') s, jsonb_array_elements(s->'notas') n
),
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
  from notas n join medios_bloqueados_global b on b.activo and lower(n.dominio) = lower(b.dominio)
),
blandos as (
  select 'seccion_vacia' as aviso, s->>'nombre' as detalle
  from cl, jsonb_array_elements(cl.j->'secciones') s where (s->>'cantidad')::int = 0
  union all
  select 'clipping_chico', 'solo ' || (select count(*)::text from notas) || ' notas'
  where (select count(*) from notas) between 1 and 4
  union all
  select 'clipping_vacio', 'ninguna nota supero el filtro' where (select count(*) from notas) = 0
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
repesca as (
  select v.candidata_id, c.titulo, v.confianza
  from candidatas_veredicto v join candidatas_raw c on c.id = v.candidata_id
  where v.client_id = p_client_id and v.fecha = (select fecha from param)
    and not v.entra and v.confianza is not null and v.confianza < 0.70
  order by v.confianza asc limit 20
)
select jsonb_build_object(
  'client_id', p_client_id, 'fecha', (select fecha from param),
  'notas', (select count(*) from notas),
  'a_sacar', coalesce((select jsonb_agg(jsonb_build_object(
      'candidata_id', candidata_id, 'titulo', titulo, 'seccion', seccion, 'motivo', motivo)) from duros), '[]'::jsonb),
  'avisos', coalesce((select jsonb_agg(jsonb_build_object('aviso', aviso, 'detalle', detalle)) from blandos), '[]'::jsonb),
  'repesca', coalesce((select jsonb_agg(jsonb_build_object(
      'candidata_id', candidata_id, 'titulo', titulo, 'confianza', confianza)) from repesca), '[]'::jsonb),
  'notas_finales', (select count(*) from notas) - (select count(distinct candidata_id) from duros)
);
$$;

create or replace function public.decidir_nivel(
  p_client_id uuid,
  p_fecha date default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with param as (select coalesce(p_fecha, v4_hoy()) as fecha),
a as (select auditar_clipping(p_client_id, (select fecha from param)) as j),
v as (
  select count(*) filter (where entra) as entran, count(*) as juzgadas,
         count(*) filter (where forzada) as forzadas
  from candidatas_veredicto
  where client_id = p_client_id and fecha = (select fecha from param)
),
p as (
  select count(*) as candidatas
  from v4_evaluar_candidatas(p_client_id, (select fecha from param))
  where descartada_por is null
)
select jsonb_build_object(
  'client_id', p_client_id, 'fecha', (select fecha from param),
  'nivel', case
    when (select candidatas from p) = 0 then 3
    when (select juzgadas from v) = 0 then 2
    when (select entran from v) = 0 then 1
    else 0 end,
  'motivo', case
    when (select candidatas from p) = 0 then 'sin candidatas: el pool no dio nada para este cliente'
    when (select juzgadas from v) = 0 then 'sin veredictos: el A2 no corrio o fallo entero'
    when (select entran from v) = 0 then 'el juez no dejo pasar ninguna'
    else 'completo' end,
  'candidatas', (select candidatas from p),
  'juzgadas', (select juzgadas from v),
  'entran', (select entran from v),
  'forzadas', (select forzadas from v),
  'notas_finales', ((select j from a)->>'notas_finales')::int,
  'avisos', ((select j from a)->'avisos'),
  'sale', true
);
$$;

grant execute on function public.armar_clipping(uuid, date) to anon, authenticated, service_role;
grant execute on function public.auditar_clipping(uuid, date) to anon, authenticated, service_role;
grant execute on function public.decidir_nivel(uuid, date) to anon, authenticated, service_role;
