-- Las notas que llegan por Google Alerts casi nunca entraban al pool de la corrida.
--
-- Medido el 18/09: Google trajo 340 candidatas y al pool entraron 15 (BMS), 12 (Booking),
-- 24 (MSD) y 0 (MARS). Comparando el clipping v4 contra el v3 del mismo día, 5 de las 6
-- exclusivas que la v3 trajo y la v4 no venían justamente por Google.
--
-- Causa: el pool acepta una candidata si su fuente está monitoreada/con tier para ese
-- cliente, o si el TÍTULO matchea una keyword o un patrón de marca. Google devuelve notas
-- de medios que el cliente no tiene suscriptos, así que quedaban afuera salvo que el título
-- tuviera la palabra justa.
--
-- Lo llamativo es que la intención ya estaba escrita: la versión de 2 argumentos de esta
-- misma función calcula un campo `viene_de_alerta`
--
--   exists (select 1 from public.google_alerts ga
--            where ga.id = c.alerta_id and ga.client_id = p_client_id and ga.activa)
--
-- y NUNCA lo usa en el WHERE. La versión de 3 argumentos, que es la que corre, directamente
-- no lo calcula. O sea que la regla "si viene de una alerta del propio cliente, entra" se
-- perdió en el camino. Esto la restituye.
--
-- El criterio es conservador: sólo entra si la alerta es de ESE cliente y está activa. No
-- se acepta cualquier cosa que venga de Google.
--
-- Impacto medido sobre las corridas del 18/09, antes de aplicar:
--   BMS      pool 3.286  ->  +190  (+5,8%)
--   Booking  pool 2.249  ->   +73  (+3,2%)
--   MSD      pool 4.338  ->   +68  (+1,6%)
--   MARS     sin cambios: no tiene ninguna alerta de Google activa configurada (es config,
--            no código; se deja anotado aparte).
--
-- Lo único que cambia es el WHERE final y el cálculo de viene_de_alerta. El resto del
-- cuerpo queda igual al que estaba en producción.

create or replace function public.v4_candidatas_aceptadas_operativo(
  p_client_id uuid,
  p_fecha date,
  p_respetar_historial boolean
)
 returns table(candidata_id uuid, es_prioritaria boolean, fecha_pub timestamp with time zone)
 language sql
 stable security definer
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
      where s.client_id = p_client_id
        and s.fuente_id = c.fuente_id
        and s.tier is not null
        and coalesce(s.bloqueado, false) = false
    ) as fuente_tier,
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
    ) as tiene_marca_titulo,
    -- Restituido: la alerta de Google del propio cliente ya es una señal de relevancia.
    exists (
      select 1
      from public.google_alerts ga
      where ga.id = c.alerta_id
        and ga.client_id = p_client_id
        and ga.activa
    ) as viene_de_alerta
  from normalizadas c
)
select
  a.candidata_id,
  a.tiene_marca_titulo as es_prioritaria,
  a.fecha_pub
from aceptadas a
where a.fuente_monitoreada
   or a.fuente_tier
   or a.tiene_marca_titulo
   or a.tiene_keyword_no_generica
   or a.viene_de_alerta
   or (a.tiene_keyword_titulo and (select slug from cliente) <> 'mars');
$function$;
