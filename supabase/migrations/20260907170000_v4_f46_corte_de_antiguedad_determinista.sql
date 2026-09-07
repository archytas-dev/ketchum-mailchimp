-- [F4.6] El corte de antiguedad sale de la fecha del clipping, no del reloj.
--
-- Antes: `fecha_pub < now() - 24 h`. El mismo (cliente, fecha) daba distinto
-- segun cuando se lo corriera. Medido sobre el pool del 04/09, tres dias
-- despues: Booking pasaba de 2.784 descartes por viejas a 5.099, BMS de 7.677
-- a 14.506. Mismos datos, otro reloj. Con eso el arnes de golden de la Fase 8
-- habria medido la diferencia entre dos relojes y la habria leido como una
-- diferencia de criterio.
--
-- Ahora el corte es el fin del dia `p_fecha` en hora local, asi que
-- "ultimas 24 h" significa "publicada el dia del clipping". La funcion es
-- reproducible: se corra hoy, manana o en la Fase 8, misma respuesta.
--
-- Consecuencia buscada y aceptada: una nota publicada el lunes 23:00 ya NO
-- entra en el clipping del martes. Antes entraba (tenia 7 h de vida a las
-- 06:30). Si Ketchum espera ver la nota de anoche, el corte se corre —pero se
-- corre en un solo lugar y sigue siendo determinista.
--
-- Alternativa evaluada y descartada (queda anotada en el roadmap): agregar
-- `p_corte timestamptz default now()` y que produccion pase now() y el golden
-- pinee el instante. Conservaba el comportamiento exacto de hoy, pero deja el
-- bug vivo: depende de que todo llamador nuevo se acuerde de pasar el
-- parametro. El default roto de `p_registrar` en [F4.4] es la prueba de que
-- eso no se sostiene.
--
-- Y la ventana tiene DOS bordes. El pool del 04/09 tiene 11 notas fechadas
-- despues de ese dia, una en 2029. Nunca eran "viejas", asi que entraban
-- siempre — y como el orden es `fecha_pub desc`, encabezaban el clipping.
-- Es el riesgo "fecha fresca-falsa" del design doc por el otro lado.
--
-- Sigue pendiente: es_repetida() mira `current_date - 30`, tambien relativo al
-- reloj. No se toca aca porque import_clipping() —que esta en produccion— la
-- usa, y cambiarle la firma necesita revision de un segundo (mandamiento 9).

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
        when es_repetida(p_client_id, d.url) then 'ya_enviada'
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
    when 'ya_enviada'         then 'ya se le envio a este cliente en los ultimos 30 dias'
  end,
  rg.id,
  case
    when v.veredicto is null                then null
    when v.veredicto = 'antiguedad'         then to_char(v.fecha_pub, 'YYYY-MM-DD HH24:MI')
    when v.veredicto = 'fecha_futura'       then to_char(v.fecha_pub, 'YYYY-MM-DD HH24:MI')
    when v.veredicto = 'titulo_pobre'       then v.titulo
    when v.veredicto = 'ya_enviada'         then public.url_canonica(v.url)
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

comment on function public.v4_evaluar_candidatas(uuid, date) is
  'Evalua el pool del dia para un cliente y devuelve, por nota, si entra y por que no. Determinista: el corte de fecha sale de p_fecha, nunca del reloj. Una sola definicion para los cuatro clientes.';

-- La fecha futura tambien es recuperable: es una nota real con la fecha rota,
-- no basura. El equipo puede subirla a mano desde el dashboard.
create or replace function public.normalizar_y_compuertas(
  p_client_id uuid,
  p_fecha date default current_date,
  p_registrar boolean default true
)
returns table (
  candidata_id uuid,
  url_canonica text,
  titulo       text,
  dominio_norm text,
  fecha_pub    timestamptz,
  prioritaria  boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_registrar then
    insert into notas_descartadas (
      client_id, fecha, url, titulo, medio, dominio,
      fase, etapa, motivo, regla_id, valor_que_matcheo, recuperable)
    select
      p_client_id, p_fecha, e.url, e.titulo, e.dominio_norm, e.dominio_norm,
      'prefilter', 'compuerta', e.motivo, e.regla_id, e.valor_que_matcheo,
      e.descartada_por in ('regla_tema', 'titulo_pobre', 'antiguedad', 'fecha_futura')
    from v4_evaluar_candidatas(p_client_id, p_fecha) e
    where e.descartada_por is not null
    on conflict (client_id, fecha, md5(coalesce(url,'')), motivo)
      where etapa = 'compuerta'
      do nothing;
  end if;

  return query
  select e.candidata_id, e.url_canonica, e.titulo, e.dominio_norm,
         e.fecha_pub, e.es_prioritaria
  from v4_evaluar_candidatas(p_client_id, p_fecha) e
  where e.descartada_por is null
  order by e.es_prioritaria desc, e.fecha_pub desc nulls last;
end;
$$;
