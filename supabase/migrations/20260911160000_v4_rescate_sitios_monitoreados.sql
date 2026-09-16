-- Replica la excepción real de la v3:
-- una fuente que el cliente pidió expresamente llega al A2 aunque el título
-- no contenga una keyword literal. Las compuertas duras (fecha, país, basura
-- y desambiguación) ya se aplicaron en v4_candidatas_aceptadas_rapido.
--
-- La marca se calcula por fuente/cliente, no por el dominio google.com ni por
-- el nombre que vino en el RSS. Se acepta tanto el vínculo explícito
-- medios_suscripcion.origen = cliente como el catálogo activo de medios tipo
-- monitoreado. Esto cubre las fuentes legacy que v3 ya trataba como monitoreadas.

create or replace function public.v4_candidatas_aceptadas_operativo(
  p_client_id uuid,
  p_fecha date,
  p_respetar_historial boolean
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
with cliente as (
  select lower(coalesce(slug, '')) as slug
  from public.clients
  where id = p_client_id
), reglas as materialized (
  select rf.*
  from public.reglas_filtro rf
  where rf.activa and (rf.client_id = p_client_id or rf.client_id is null)
), keywords as materialized (
  select public.v4_keyword_norm(k.keyword) as keyword_norm
  from public.kw_keywords k
  where k.client_id = p_client_id
    and k.activa
    and nullif(public.v4_keyword_norm(k.keyword), '') is not null
), candidatas as materialized (
  select
    q.candidata_id,
    q.fecha_pub,
    c.titulo,
    c.alerta_id,
    exists (
      select 1
      from public.medios_suscripcion s
      join public.medios_fuentes f
        on f.id = s.fuente_id
       and f.activa
      where s.client_id = p_client_id
        and s.fuente_id = c.fuente_id
        and coalesce(s.bloqueado, false) = false
        and (
          s.origen = 'cliente'
          or exists (
            select 1
            from public.medios m
            where m.client_id = p_client_id
              and m.activo
              and m.tipo = 'monitoreado'
              and lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) = f.dominio_norm
          )
        )
    ) as fuente_monitoreada
  from public.v4_candidatas_aceptadas_rapido(
    p_client_id,
    p_fecha,
    p_respetar_historial
  ) q
  join public.candidatas_raw c on c.id = q.candidata_id
), normalizadas as materialized (
  select
    c.*,
    public.v4_keyword_norm(coalesce(c.titulo, '')) as titulo_norm
  from candidatas c
), aceptadas as (
  select
    c.*,
    exists (
      select 1
      from keywords k
      where (' ' || c.titulo_norm || ' ') like ('% ' || k.keyword_norm || ' %')
    ) as tiene_keyword_titulo,
    exists (
      select 1
      from keywords k
      where (' ' || c.titulo_norm || ' ') like ('% ' || k.keyword_norm || ' %')
        and not (
          (select slug from cliente) = 'mars'
          and k.keyword_norm = 'inflacion'
        )
    ) as tiene_keyword_no_generica,
    exists (
      select 1
      from reglas r
      where r.compuerta = 'entra_si_o_si'
        and r.tipo = 'patron_titulo'
        and coalesce(c.titulo, '') ~* r.valor
    ) as tiene_marca_titulo
  from normalizadas c
)
select
  a.candidata_id,
  (a.fuente_monitoreada or a.tiene_marca_titulo) as es_prioritaria,
  a.fecha_pub
from aceptadas a
where a.fuente_monitoreada
   or a.tiene_marca_titulo
   or a.tiene_keyword_no_generica
   or (a.tiene_keyword_titulo and (select slug from cliente) <> 'mars');
$function$;

comment on function public.v4_candidatas_aceptadas_operativo(uuid, date, boolean) is
  'Pool operativo: replica el rescate v3 para fuentes monitoreadas; mantiene keywords para adicionales y alertas, con compuertas duras previas.';

grant execute on function public.v4_candidatas_aceptadas_operativo(uuid, date, boolean)
  to anon, authenticated, service_role;
