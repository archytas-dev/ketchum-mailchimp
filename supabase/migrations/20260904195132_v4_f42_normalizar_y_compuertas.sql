-- [F4.2] normalizar_y_compuertas(): del pool crudo a las candidatas de un cliente.
--
-- Determinística y en SQL a propósito: una definición para los cuatro clientes, y dos
-- corridas del mismo día dan exactamente lo mismo (es un test del golden).
--
-- Orden: suscripción -> fecha -> compuertas -> dedup. La dedup va ÚLTIMA para que el
-- descarte que se registra sea el más informativo: si una nota se cae por regla, eso
-- dice más que "era repetida".
--
-- Cada descarte se escribe con la regla exacta y el valor que la disparó. Es lo que
-- hace que las correcciones del equipo puedan alimentar la configuración.

create or replace function public.normalizar_y_compuertas(
  p_client_id uuid,
  p_fecha     date default current_date,
  p_registrar boolean default true
) returns table (
  candidata_id   uuid,
  url_canonica   text,
  titulo         text,
  dominio_norm   text,
  fecha_pub      timestamptz,
  prioritaria    boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ventana_h int;
  v_titulo_min int;
begin
  -- Las reglas parametrizadas se leen de la tabla, no se hardcodean acá.
  select coalesce(max(valor::int), 24)  into v_ventana_h
    from reglas_filtro
   where activa and tipo='antiguedad' and (client_id is null or client_id = p_client_id);
  select coalesce(max(valor::int), 25)  into v_titulo_min
    from reglas_filtro
   where activa and tipo='titulo_corto' and (client_id is null or client_id = p_client_id);

  return query
  with
  -- 1. Solo las fuentes a las que ESTE cliente está suscripto. El pool es compartido;
  --    el recorte por cliente pasa acá, no en la recolección (decisión 6).
  suscritas as (
    select c.*
    from candidatas_raw c
    join medios_fuentes f      on f.id = c.fuente_id and f.activa is true
    join medios_suscripcion s  on s.fuente_id = f.id
                              and s.client_id = p_client_id
                              and coalesce(s.bloqueado,false) = false
    where c.fecha = p_fecha
  ),
  -- 2. Las reglas que aplican: las globales más las de este cliente.
  reglas as (
    select * from reglas_filtro
     where activa and (client_id is null or client_id = p_client_id)
  ),
  -- 3. Compuertas. entra_si_o_si se evalúa PRIMERO y gana sobre todo lo demás.
  evaluadas as (
    select
      s.*,
      exists (
        select 1 from reglas r
        where r.compuerta = 'entra_si_o_si'
          and r.tipo = 'patron_titulo'
          and (coalesce(s.titulo,'') || ' ' || coalesce(s.snippet,'')) ~* r.valor
      ) as es_prioritaria,
      (
        select r.id from reglas r
        where r.compuerta = 'no_entra_nunca'
          and (
            (r.tipo = 'patron_titulo' and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~* r.valor
             -- la excepción argentina: una nota que dice "argentin" no se descarta por
             -- hablar de otro mercado
             and not (r.valor ~ 'espa' and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~* 'argentin'))
         or (r.tipo = 'patron_url'    and coalesce(s.url,'') ~* r.valor)
         or (r.tipo = 'tld'           and s.dominio_norm ~* r.valor)
         or (r.tipo = 'dominio'       and s.dominio_norm ~* r.valor)
          )
        limit 1
      ) as regla_que_descarta,
      -- Antigüedad: SOLO si la fecha es confiable. Nunca se descarta por vieja algo
      -- de lo que no se sabe cuándo se publicó.
      (s.fecha_confiable and s.fecha_pub < now() - make_interval(hours => v_ventana_h)) as es_vieja,
      (length(coalesce(s.titulo,'')) < v_titulo_min
        and length(coalesce(s.snippet,'')) < 20) as es_titulo_pobre
    from suscritas s
  ),
  con_motivo as (
    select e.*,
      case
        when e.es_prioritaria                    then null
        when e.regla_que_descarta is not null    then 'regla'
        when e.es_vieja                          then 'antiguedad'
        when e.es_titulo_pobre                   then 'titulo_pobre'
        when not e.fecha_confiable and e.titulo is null then 'sin_datos'
        else null
      end as motivo_descarte
    from evaluadas e
  ),
  -- 4. Dedup por título dentro del mismo medio. Una nota prioritaria NUNCA se
  --    deduplica cross-medio: cada medio que la publica es un placement distinto.
  numeradas as (
    select cm.*,
      row_number() over (
        partition by cm.dominio_norm, lower(regexp_replace(coalesce(cm.titulo,''), '[^a-zA-Z0-9]+', '', 'g'))
        order by cm.fecha_confiable desc, cm.fecha_pub desc nulls last, cm.capturado_at
      ) as rn
    from con_motivo cm
    where cm.motivo_descarte is null
  )
  select n.id, n.url_canonica, n.titulo, n.dominio_norm, n.fecha_pub, n.es_prioritaria
  from numeradas n
  where n.rn = 1
  order by n.es_prioritaria desc, n.fecha_pub desc nulls last;

  -- 5. El registro de descartes: qué regla y qué valor lo sacó.
  if p_registrar then
    insert into notas_descartadas (client_id, fecha, url, titulo, medio, motivo,
                                   etapa, regla_id, valor_que_matcheo, recuperable)
    select
      p_client_id, p_fecha, s.url, s.titulo, s.dominio_norm,
      coalesce(r.motivo, 'compuerta'),
      'compuerta', r.id, s.dominio_norm, true
    from candidatas_raw s
    join medios_fuentes f     on f.id = s.fuente_id
    join medios_suscripcion m on m.fuente_id = f.id and m.client_id = p_client_id
    left join reglas_filtro r on r.id = (
      select r2.id from reglas_filtro r2
      where r2.activa and r2.compuerta='no_entra_nunca'
        and (r2.client_id is null or r2.client_id = p_client_id)
        and ( (r2.tipo='patron_titulo' and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~* r2.valor)
           or (r2.tipo='patron_url'    and coalesce(s.url,'') ~* r2.valor)
           or (r2.tipo='tld'           and s.dominio_norm ~* r2.valor)
           or (r2.tipo='dominio'       and s.dominio_norm ~* r2.valor) )
      limit 1)
    where s.fecha = p_fecha and r.id is not null
    on conflict do nothing;
  end if;
end;
$$;

comment on function public.normalizar_y_compuertas(uuid, date, boolean) is
  'Del pool compartido a las candidatas de un cliente: filtra por suscripción, aplica las tres compuertas de reglas_filtro y deduplica por título intra-medio. Determinística — dos corridas del mismo día dan lo mismo. entra_si_o_si gana sobre todo; la antigüedad solo descarta con fecha confiable; una nota prioritaria nunca se deduplica cross-medio.';
