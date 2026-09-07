-- normalizar_y_compuertas() con la cuarta compuerta. Precedencia, de mayor a menor:
--   1. desambiguacion  -> la palabra parece la marca y no lo es. Gana sobre TODO.
--   2. entra_si_o_si   -> menciona al cliente de verdad: ninguna regla de tema la saca.
--   3. no_entra_nunca  -> descarte duro por tema.
--   4. fecha / título pobre.
-- Sin el paso 1, toda marca ambigua es una puerta abierta: "Karol G y Bruno Mars"
-- entraba como prioritaria para Mars.

create or replace function public.normalizar_y_compuertas(
  p_client_id uuid,
  p_fecha     date default current_date,
  p_registrar boolean default true
) returns table (
  candidata_id uuid, url_canonica text, titulo text,
  dominio_norm text, fecha_pub timestamptz, prioritaria boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_ventana_h int; v_titulo_min int;
begin
  select coalesce(max(valor::int),24) into v_ventana_h
    from reglas_filtro where activa and tipo='antiguedad'
      and (client_id is null or client_id=p_client_id);
  select coalesce(max(valor::int),25) into v_titulo_min
    from reglas_filtro where activa and tipo='titulo_corto'
      and (client_id is null or client_id=p_client_id);

  return query
  with suscritas as (
    select c.* from candidatas_raw c
    join medios_fuentes f     on f.id=c.fuente_id and f.activa is true
    join medios_suscripcion s on s.fuente_id=f.id and s.client_id=p_client_id
                             and coalesce(s.bloqueado,false)=false
    where c.fecha=p_fecha
  ),
  reglas as (
    select * from reglas_filtro
    where activa and (client_id is null or client_id=p_client_id)
  ),
  ev as (
    select s.*,
      -- 1. Desambiguación: gana sobre todo, incluso sobre la marca.
      exists (select 1 from reglas r where r.compuerta='desambiguacion'
              and ((r.tipo='patron_titulo' and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~* r.valor)
                or (r.tipo='patron_url'    and coalesce(s.url,'') ~* r.valor))) as es_ambigua,
      -- 2. Marca del cliente.
      exists (select 1 from reglas r where r.compuerta='entra_si_o_si'
              and r.tipo='patron_titulo'
              and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~* r.valor) as menciona_marca,
      -- 3. Descarte duro por tema.
      (select r.id from reglas r where r.compuerta='no_entra_nunca'
        and ( (r.tipo='patron_titulo' and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~* r.valor
               and not (r.valor ~ 'espa' and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~* 'argentin')
               -- MSD: lo fuera de scope solo descarta si no hay eje sanitario
               and not (r.valor ~ 'volkswagen' and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~*
                        '(enfermedad|vacuna|brote|sanidad|sanitari|zoonosis|parasit|garrapata|mastitis|bienestar animal)')
               -- Mars: lo agro solo descarta si no hay rubro del cliente
               and not (r.valor ~ 'senasa' and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~*
                        '(aliment|nutricion|petfood|mascota|perro|gato|balanceado|golosina|chocolat|confiter|snack)'))
           or (r.tipo='patron_url' and coalesce(s.url,'') ~* r.valor)
           or (r.tipo='tld'        and s.dominio_norm ~* r.valor)
           or (r.tipo='dominio'    and s.dominio_norm ~* r.valor) )
        limit 1) as regla_descarta,
      (s.fecha_confiable and s.fecha_pub < now() - make_interval(hours=>v_ventana_h)) as es_vieja,
      (length(coalesce(s.titulo,'')) < v_titulo_min
        and length(coalesce(s.snippet,'')) < 20) as titulo_pobre
    from suscritas s
  ),
  filtradas as (
    select e.*, (e.menciona_marca and not e.es_ambigua) as es_prioritaria
    from ev e
    where not e.es_ambigua                                        -- 1
      and ( (e.menciona_marca)                                     -- 2 gana sobre 3 y 4
         or (e.regla_descarta is null and not e.es_vieja and not e.titulo_pobre) )
  ),
  num as (
    select f.*, row_number() over (
      partition by f.dominio_norm,
        lower(regexp_replace(coalesce(f.titulo,''),'[^a-zA-Z0-9]+','','g'))
      order by f.es_prioritaria desc, f.fecha_confiable desc,
               f.fecha_pub desc nulls last, f.capturado_at) as rn
    from filtradas f
  )
  select n.id, n.url_canonica, n.titulo, n.dominio_norm, n.fecha_pub, n.es_prioritaria
  from num n where n.rn=1
  order by n.es_prioritaria desc, n.fecha_pub desc nulls last;

  if p_registrar then
    insert into notas_descartadas (client_id, fecha, url, titulo, medio, motivo,
                                   etapa, regla_id, valor_que_matcheo, recuperable)
    select p_client_id, p_fecha, s.url, s.titulo, s.dominio_norm,
           coalesce(r.motivo,'compuerta'), 'compuerta', r.id, s.dominio_norm, true
    from candidatas_raw s
    join medios_fuentes f     on f.id=s.fuente_id
    join medios_suscripcion m on m.fuente_id=f.id and m.client_id=p_client_id
    join reglas_filtro r on r.id=(
      select r2.id from reglas_filtro r2
      where r2.activa and r2.compuerta in ('no_entra_nunca','desambiguacion')
        and (r2.client_id is null or r2.client_id=p_client_id)
        and ( (r2.tipo='patron_titulo' and (coalesce(s.titulo,'')||' '||coalesce(s.snippet,'')) ~* r2.valor)
           or (r2.tipo='patron_url' and coalesce(s.url,'') ~* r2.valor)
           or (r2.tipo='tld'        and s.dominio_norm ~* r2.valor)
           or (r2.tipo='dominio'    and s.dominio_norm ~* r2.valor) )
      limit 1)
    where s.fecha=p_fecha
    on conflict do nothing;
  end if;
end; $$;
