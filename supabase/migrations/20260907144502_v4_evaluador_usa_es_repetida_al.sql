-- El evaluador pasa a usar es_repetida_al(): determinista (mide contra p_fecha,
-- no contra el reloj) y sin recalcular url_canonica por nota. Supersede la
-- definicion de 20260907170000. Sin este cambio la corrida de los cuatro
-- clientes se muere por statement timeout.

create or replace function public.v4_evaluar_candidatas(
  p_client_id uuid,
  p_fecha date default current_date
)
returns table (
  candidata_id      uuid,
  url               text,
  url_canonica      text,
  titulo            text,
  dominio_norm      text,
  fecha_pub         timestamptz,
  es_prioritaria    boolean,
  descartada_por    text,
  motivo            text,
  regla_id          uuid,
  valor_que_matcheo text
)
language sql
stable
security definer
set search_path to 'public'
as $$
with cfg as (
  select
    coalesce((select max(rf.valor::int) from reglas_filtro rf
               where rf.activa and rf.tipo = 'antiguedad'
                 and (rf.client_id is null or rf.client_id = p_client_id)), 24) as ventana_h,
    coalesce((select max(rf.valor::int) from reglas_filtro rf
               where rf.activa and rf.tipo = 'titulo_corto'
                 and (rf.client_id is null or rf.client_id = p_client_id)), 25) as titulo_min,
    -- El instante contra el que se mide todo: fin del dia del clipping, hora
    -- local. Sale de p_fecha, nunca del reloj.
    ((p_fecha + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as corte
),
suscritas as (
  select c.*
  from candidatas_raw c
  join medios_fuentes f     on f.id = c.fuente_id and f.activa is true
  join medios_suscripcion m on m.fuente_id = f.id and m.client_id = p_client_id
                           and coalesce(m.bloqueado, false) = false
  where c.fecha = p_fecha
),
reglas as (
  select rf.* from reglas_filtro rf
  where rf.activa and (rf.client_id is null or rf.client_id = p_client_id)
),
ev as (
  select s.*,
    (coalesce(s.titulo,'') || ' ' || coalesce(s.snippet,'')) as txt,
    (select r.id from reglas r
      where r.compuerta = 'desambiguacion'
        and ( (r.tipo = 'patron_titulo'
               and (coalesce(s.titulo,'') || ' ' || coalesce(s.snippet,'')) ~* r.valor)
           or (r.tipo = 'patron_url' and coalesce(s.url,'') ~* r.valor) )
      limit 1) as regla_ambigua,
    exists (select 1 from reglas r
             where r.compuerta = 'entra_si_o_si' and r.tipo = 'patron_titulo'
               and (coalesce(s.titulo,'') || ' ' || coalesce(s.snippet,'')) ~* r.valor
           ) as menciona_marca,
    (select r.id from reglas r
      where r.compuerta = 'no_entra_nunca'
        and ( (r.tipo = 'patron_titulo'
               and (coalesce(s.titulo,'') || ' ' || coalesce(s.snippet,'')) ~* r.valor
               and not (r.valor ~ 'espa'
                        and (coalesce(s.titulo,'') || ' ' || coalesce(s.snippet,'')) ~* 'argentin')
               and not (r.valor ~ 'volkswagen'
                        and (coalesce(s.titulo,'') || ' ' || coalesce(s.snippet,'')) ~*
                            '(enfermedad|vacuna|brote|sanidad|sanitari|zoonosis|parasit|garrapata|mastitis|bienestar animal)')
               and not (r.valor ~ 'senasa'
                        and (coalesce(s.titulo,'') || ' ' || coalesce(s.snippet,'')) ~*
                            '(aliment|nutricion|petfood|mascota|perro|gato|balanceado|golosina|chocolat|confiter|snack)') )
           or (r.tipo = 'patron_url' and coalesce(s.url,'') ~* r.valor)
           or (r.tipo = 'tld'        and s.dominio_norm ~* r.valor)
           or (r.tipo = 'dominio'    and s.dominio_norm ~* r.valor) )
      limit 1) as regla_tema,
    -- La antiguedad solo descarta con fecha confiable: no se descarta por vieja
    -- algo de lo que no se sabe cuando se publico.
    (s.fecha_confiable
     and s.fecha_pub < (select cfg.corte from cfg)
                       - make_interval(hours => (select cfg.ventana_h from cfg))) as es_vieja,
    -- El otro borde de la ventana: una fecha posterior al dia del clipping es
    -- un dato roto, y como el orden es fecha_pub desc, encabezaria el envio.
    (s.fecha_confiable and s.fecha_pub >= (select cfg.corte from cfg)) as fecha_futura,
    (length(coalesce(s.titulo,'')) < (select cfg.titulo_min from cfg)
     and length(coalesce(s.snippet,'')) < 20) as titulo_pobre
  from suscritas s
),
gated as (
  select e.*,
    (e.menciona_marca and e.regla_ambigua is null) as es_prioritaria,
    case
      -- Los dos primeros son defectos del dato, no juicios de relevancia:
      -- ganan incluso sobre la marca del cliente.
      when e.regla_ambigua is not null then 'desambiguacion'
      when e.fecha_futura              then 'fecha_futura'
      when e.menciona_marca            then null   -- la marca gana sobre lo que sigue
      when e.regla_tema is not null    then 'regla_tema'
      when e.es_vieja                  then 'antiguedad'
      when e.titulo_pobre              then 'titulo_pobre'
      else null
    end as gate
  from ev e
),
deduped as (
  select g.*,
    case when g.gate is null then
      row_number() over (
        partition by g.dominio_norm,
          lower(regexp_replace(coalesce(g.titulo,''), '[^a-zA-Z0-9]+', '', 'g'))
        order by g.es_prioritaria desc, g.fecha_confiable desc,
                 g.fecha_pub desc nulls last, g.capturado_at)
    end as rn
  from gated g
),
veredicto as (
  select d.*,
    coalesce(
      d.gate,
      case
        when d.rn > 1                        then 'repetida_en_el_dia'
        when es_repetida_al(p_client_id, d.url_canonica, p_fecha) then 'ya_enviada'
      end
    ) as veredicto
  from deduped d
)
select
  v.id,
  v.url,
  v.url_canonica,
  v.titulo,
  v.dominio_norm,
  v.fecha_pub,
  v.es_prioritaria,
  v.veredicto,
  case v.veredicto
    when 'desambiguacion'     then coalesce(rg.motivo, 'la palabra parece la marca y no lo es')
    when 'regla_tema'         then coalesce(rg.motivo, 'el tema no le sirve al cliente')
    when 'antiguedad'         then 'publicada antes del dia del clipping (ventana de '
                                   || (select cfg.ventana_h from cfg) || ' h)'
    when 'fecha_futura'       then 'la fecha de publicacion cae despues del dia del clipping'
    when 'titulo_pobre'       then 'titulo corto y sin copete'
    when 'repetida_en_el_dia' then 'el mismo medio ya publico esta nota en la corrida'
    when 'ya_enviada'         then 'ya se le envio a este cliente en los 30 dias previos'
  end,
  rg.id,
  case
    when v.veredicto is null                then null
    when v.veredicto = 'antiguedad'         then to_char(v.fecha_pub, 'YYYY-MM-DD HH24:MI')
    when v.veredicto = 'fecha_futura'       then to_char(v.fecha_pub, 'YYYY-MM-DD HH24:MI')
    when v.veredicto = 'titulo_pobre'       then v.titulo
    when v.veredicto = 'ya_enviada'         then v.url_canonica
    when v.veredicto = 'repetida_en_el_dia' then v.dominio_norm
    else coalesce(
      (regexp_match(v.txt, '(' || rg.valor || ')', 'i'))[1],
      (regexp_match(coalesce(v.url,''), '(' || rg.valor || ')', 'i'))[1],
      v.dominio_norm)
  end
from veredicto v
left join reglas_filtro rg
  on rg.id = case when v.veredicto in ('desambiguacion','regla_tema')
                  then coalesce(v.regla_ambigua, v.regla_tema) end;
$$;
