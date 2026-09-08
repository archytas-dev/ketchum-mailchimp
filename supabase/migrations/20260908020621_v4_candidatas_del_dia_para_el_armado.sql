-- Lo que wf/armado-cliente le da de comer al A1 y al A2: las candidatas del dia
-- ya filtradas, con todo lo que los agentes necesitan y nada mas.
--
-- Es una capa fina sobre v4_evaluar_candidatas() a proposito: la logica de
-- filtrado sigue viviendo en un solo lugar. Aca solo se agrega el snippet y el
-- transporte, que los agentes usan y el evaluador no devuelve.
create or replace function public.v4_candidatas_del_dia(
  p_client_id uuid,
  p_fecha date default null,
  p_limite int default 60
)
returns table (
  candidata_id uuid, titulo text, snippet text, url text,
  dominio_norm text, fecha_pub timestamptz, fecha_confiable boolean,
  es_prioritaria boolean, transporte text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  -- coalesce con v4_hoy(): si no viene fecha, el dia ARGENTINO. Un default
  -- current_date aca dejaria el armado ciego entre las 21:00 y la medianoche.
  select e.candidata_id, e.titulo, c.snippet, c.url,
         e.dominio_norm, e.fecha_pub, c.fecha_confiable,
         e.es_prioritaria, coalesce(me.transporte, 'directo')
  from v4_evaluar_candidatas(p_client_id, coalesce(p_fecha, v4_hoy())) e
  join candidatas_raw c on c.id = e.candidata_id
  left join medios_estrategia me on me.dominio_norm = e.dominio_norm
  where e.descartada_por is null
  -- Las prioritarias primero: si el lote se corta por el limite, lo que se
  -- pierde es lo menos importante, no lo mas.
  order by e.es_prioritaria desc, e.fecha_pub desc nulls last
  limit greatest(1, least(p_limite, 200));
$$;

comment on function public.v4_candidatas_del_dia(uuid, date, int) is
  'Candidatas del dia listas para los agentes. Capa fina sobre v4_evaluar_candidatas: el filtrado sigue en un solo lugar. Prioritarias primero, para que el limite corte lo menos importante.';

grant execute on function public.v4_candidatas_del_dia(uuid, date, int) to anon, authenticated, service_role;
