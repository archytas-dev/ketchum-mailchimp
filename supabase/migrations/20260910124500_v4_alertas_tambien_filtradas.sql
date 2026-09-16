-- Google Alerts es una fuente, no un pase libre. La v3 también les aplica el
-- filtro de título; sin esto BMS recibía cientos de alertas generales.

create or replace function public.v4_candidatas_aceptadas_operativo(
  p_client_id uuid,
  p_fecha date default null
)
returns table (
  candidata_id uuid,
  es_prioritaria boolean,
  fecha_pub timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with reglas as materialized (
  select rf.*
  from public.reglas_filtro rf
  where rf.activa and (rf.client_id is null or rf.client_id = p_client_id)
), keywords as materialized (
  select public.v4_keyword_norm(k.keyword) as keyword_norm
  from public.kw_keywords k
  where k.client_id = p_client_id and k.activa
    and nullif(public.v4_keyword_norm(k.keyword), '') is not null
), candidatas as materialized (
  select q.candidata_id, q.es_prioritaria, q.fecha_pub,
         c.titulo, c.alerta_id
  from public.v4_candidatas_aceptadas_rapido(p_client_id, p_fecha) q
  join public.candidatas_raw c on c.id = q.candidata_id
), normalizadas as materialized (
  select c.*, public.v4_keyword_norm(coalesce(c.titulo, '')) as titulo_norm
  from candidatas c
), aceptadas as (
  select c.*,
    exists (
      select 1 from keywords k
      where (' ' || c.titulo_norm || ' ') like ('% ' || k.keyword_norm || ' %')
    ) as tiene_keyword_titulo,
    exists (
      select 1 from reglas r
      where r.compuerta = 'entra_si_o_si'
        and r.tipo = 'patron_titulo'
        and coalesce(c.titulo, '') ~* r.valor
    ) as tiene_marca_titulo,
    exists (
      select 1 from public.google_alerts ga
      where ga.id = c.alerta_id and ga.client_id = p_client_id and ga.activa
    ) as viene_de_alerta
  from normalizadas c
)
select a.candidata_id,
       (a.tiene_marca_titulo or a.viene_de_alerta) as es_prioritaria,
       a.fecha_pub
from aceptadas a
where a.tiene_keyword_titulo or a.tiene_marca_titulo;
$function$;

comment on function public.v4_candidatas_aceptadas_operativo(uuid, date) is
  'Pool diario: Google Alerts también debe tener keyword o marca en el título, igual que la v3.';
