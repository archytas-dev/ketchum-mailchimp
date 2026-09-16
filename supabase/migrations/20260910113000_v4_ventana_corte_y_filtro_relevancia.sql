-- v4: alinear la ventana con la v3 y achicar el pool antes de A1/A2.
--
-- La v3 no corta a medianoche: cada cliente tiene un horario de salida y la
-- ventana de 24 horas termina diez minutos antes. La v4 anterior usaba
-- candidatas_raw.fecha = p_fecha y un corte a las 00:00 ART; eso perdia notas
-- publicadas el dia anterior que si estaban dentro de la ventana del clipping.
--
-- El recolector sigue siendo compartido. Esta migracion solo decide que entra
-- al pool de cada cliente. No marca notas como enviadas ni modifica la v3.

create or replace function public.v4_corte_cliente_art(
  p_client_id uuid,
  p_fecha date default null
)
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
with cliente as (
  select lower(coalesce(c.slug, '')) as slug,
         coalesce(p_fecha, public.v4_hoy())::date as fecha
  from public.clients c
  where c.id = p_client_id
)
select (
  fecha::timestamp
  + case slug
      when 'mars' then interval '6 hours 35 minutes'
      when 'bms' then interval '6 hours 50 minutes'
      when 'booking' then interval '7 hours 5 minutes'
      when 'msd' then interval '7 hours 20 minutes'
      else interval '6 hours 50 minutes'
    end
) at time zone 'America/Argentina/Buenos_Aires'
from cliente;
$function$;

comment on function public.v4_corte_cliente_art(uuid, date) is
  'Corte de lectura del clipping v4: diez minutos antes del cron v3. Devuelve un instante absoluto en ART.';

grant execute on function public.v4_corte_cliente_art(uuid, date)
  to anon, authenticated, service_role;

-- La operación diaria recolecta sitios monitoreados y fuentes que tienen tier.
-- Los adicionales sin tier quedan para la pasada completa posterior.
create or replace view public.v4_fuentes_prioritarias as
with monitoreadas as (
  select distinct
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm
  from public.medios m
  where m.activo
    and m.tipo = 'monitoreado'
), con_tier as (
  select distinct s.fuente_id
  from public.medios_suscripcion s
  where coalesce(s.bloqueado, false) = false
    and s.tier is not null
)
select f.id as fuente_id, f.dominio_norm
from public.medios_fuentes f
where f.activa
  and (
    exists (select 1 from monitoreadas m where m.dominio_norm = f.dominio_norm)
    or exists (select 1 from con_tier t where t.fuente_id = f.id)
  );

comment on view public.v4_fuentes_prioritarias is
  'Barrido diario: sitios monitoreados y fuentes con tier. Los adicionales sin tier quedan fuera de esta ventana.';

create or replace function public.v4_candidatas_aceptadas_rapido(
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
with param as (
  select coalesce(p_fecha, public.v4_hoy())::date as fecha
), reglas as materialized (
  select rf.*
  from public.reglas_filtro rf
  where rf.activa and (rf.client_id is null or rf.client_id = p_client_id)
), cfg as (
  select
    coalesce((select max(valor::int) from reglas where tipo = 'antiguedad'), 24) as ventana_h,
    coalesce((select max(valor::int) from reglas where tipo = 'titulo_corto'), 25) as titulo_min,
    public.v4_corte_cliente_art(p_client_id, (select fecha from param)) as corte
), suscritas as materialized (
  select c.*, m.tier as fuente_tier,
    (coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) as txt,
    exists (
      select 1
      from public.medios m0
      where m0.client_id = p_client_id
        and m0.activo
        and m0.tipo = 'monitoreado'
        and lower(regexp_replace(regexp_replace(regexp_replace(trim(m0.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) = c.dominio_norm
    ) as fuente_monitoreada,
    exists (
      select 1
      from public.kw_keywords k
      where k.client_id = p_client_id
        and k.activa
        and (' ' || public.v4_keyword_norm(coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) || ' ')
            like ('% ' || public.v4_keyword_norm(k.keyword) || ' %')
    ) as tiene_keyword,
    c.alerta_id is not null as viene_de_alerta
  from public.candidatas_raw c
  join public.medios_fuentes f
    on f.id = c.fuente_id and f.activa is true
  join public.medios_suscripcion m
    on m.fuente_id = f.id
   and m.client_id = p_client_id
   and coalesce(m.bloqueado, false) = false
  where c.fecha between (select fecha from param) - 1 and (select fecha from param)
    and (
      (c.fecha_confiable
        and c.fecha_pub >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg))
        and c.fecha_pub < (select corte from cfg))
      or
      ((not c.fecha_confiable or c.fecha_pub is null)
        and c.capturado_at >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg))
        and c.capturado_at < (select corte from cfg))
    )
), base as (
  select s.*,
    exists (
      select 1 from reglas r
      where r.compuerta = 'entra_si_o_si' and r.tipo = 'patron_titulo'
        and s.txt ~* r.valor
    ) as marca,
    (s.fecha_confiable and s.fecha_pub < (select corte from cfg)
      - make_interval(hours => (select ventana_h from cfg))) as vieja,
    (s.fecha_confiable and s.fecha_pub >= (select corte from cfg)) as futura,
    (length(coalesce(s.titulo, '')) < (select titulo_min from cfg)
      and length(coalesce(s.snippet, '')) < 20) as titulo_pobre
  from suscritas s
), candidatas_a_regla as (
  select b.*
  from base b
  where b.marca or (not b.vieja and not b.futura and not b.titulo_pobre)
), filtradas as (
  select b.*,
    exists (
      select 1 from reglas r
      where r.compuerta = 'desambiguacion'
        and ((r.tipo = 'patron_titulo' and b.txt ~* r.valor)
          or (r.tipo = 'patron_url' and coalesce(b.url, '') ~* r.valor))
    ) as ambigua,
    exists (
      select 1 from reglas r
      where r.compuerta = 'no_entra_nunca'
        and (
          (r.tipo = 'patron_titulo' and b.txt ~* r.valor
            and not (r.valor ~ 'espa' and b.txt ~* 'argentin')
            and not (r.valor ~ 'volkswagen' and b.txt ~*
              '(enfermedad|vacuna|brote|sanidad|sanitari|zoonosis|parasit|garrapata|mastitis|bienestar animal)')
            and not (r.valor ~ 'senasa' and b.txt ~*
              '(aliment|nutricion|petfood|mascota|perro|gato|balanceado|golosina|chocolat|confiter|snack)'))
          or (r.tipo = 'patron_url' and coalesce(b.url, '') ~* r.valor)
          or (r.tipo = 'tld' and coalesce(b.dominio_norm, '') ~* r.valor)
          or (r.tipo = 'dominio' and coalesce(b.dominio_norm, '') ~* r.valor)
        )
    ) as tema_descartado,
    (b.fuente_monitoreada or b.fuente_tier is not null or b.tiene_keyword or b.marca or b.viene_de_alerta) as tiene_ancla
  from candidatas_a_regla b
), pasan_compuerta as (
  select f.*,
    (f.marca and not f.ambigua) as es_prioritaria
  from filtradas f
  where not f.ambigua
    and (f.marca or not f.tema_descartado)
    and f.tiene_ancla
), sin_repetida_del_dia as (
  select p.*,
    row_number() over (
      partition by p.dominio_norm,
        lower(regexp_replace(coalesce(p.titulo, ''), '[^a-zA-Z0-9]+', '', 'g'))
      order by (p.marca and not p.ambigua) desc, p.fecha_confiable desc,
        p.fecha_pub desc nulls last, p.capturado_at
    ) as rn
  from pasan_compuerta p
), aceptadas as (
  select p.*
  from sin_repetida_del_dia p
  left join public.notas_historico_url h
    on h.client_id = p_client_id
   and h.url_norm = p.url_canonica
   and h.primera_vez_fecha >= (select fecha from param) - 30
  where p.rn = 1 and h.id is null
)
select id, (es_prioritaria or fuente_monitoreada or fuente_tier is not null), fecha_pub
from aceptadas;
$function$;

comment on function public.v4_candidatas_aceptadas_rapido(uuid, date) is
  'Pool previo a A1/A2: ventana de 24 h al corte de cada mail, con ancla en sitio monitoreado, tier, keyword, marca o Google Alert.';

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
as $function$
with param as (
  select coalesce(p_fecha, public.v4_hoy())::date as fecha
), cfg as (
  select
    coalesce((select max(rf.valor::int) from public.reglas_filtro rf
               where rf.activa and rf.tipo='antiguedad'
                 and (rf.client_id is null or rf.client_id=p_client_id)),24) as ventana_h,
    coalesce((select max(rf.valor::int) from public.reglas_filtro rf
               where rf.activa and rf.tipo='titulo_corto'
                 and (rf.client_id is null or rf.client_id=p_client_id)),25) as titulo_min,
    public.v4_corte_cliente_art(p_client_id, (select fecha from param)) as corte
),
suscritas as (
  select c.*,
    (coalesce(c.titulo,'') || ' ' || coalesce(c.snippet,'')) as txt,
    exists (
      select 1 from public.medios m0
      where m0.client_id=p_client_id and m0.activo and m0.tipo='monitoreado'
        and lower(regexp_replace(regexp_replace(regexp_replace(trim(m0.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', ''))=c.dominio_norm
    ) as fuente_monitoreada,
    exists (
      select 1 from public.kw_keywords k
      where k.client_id=p_client_id and k.activa
        and (' ' || public.v4_keyword_norm(coalesce(c.titulo,'') || ' ' || coalesce(c.snippet,'')) || ' ')
            like ('% ' || public.v4_keyword_norm(k.keyword) || ' %')
    ) as tiene_keyword,
    c.alerta_id is not null as viene_de_alerta,
    m.tier as fuente_tier
  from public.candidatas_raw c
  join public.medios_fuentes f on f.id=c.fuente_id and f.activa is true
  join public.medios_suscripcion m on m.fuente_id=f.id and m.client_id=p_client_id
                                   and coalesce(m.bloqueado,false)=false
  where c.fecha between (select fecha from param) - 1 and (select fecha from param)
    and (
      (c.fecha_confiable
        and c.fecha_pub >= (select corte from cfg) - make_interval(hours=>(select ventana_h from cfg))
        and c.fecha_pub < (select corte from cfg))
      or
      ((not c.fecha_confiable or c.fecha_pub is null)
        and c.capturado_at >= (select corte from cfg) - make_interval(hours=>(select ventana_h from cfg))
        and c.capturado_at < (select corte from cfg))
    )
),
reglas as (
  select rf.* from public.reglas_filtro rf
  where rf.activa and (rf.client_id is null or rf.client_id=p_client_id)
), ev as (
  select s.*,
    (select r.id from reglas r where r.compuerta='desambiguacion'
      and ((r.tipo='patron_titulo' and s.txt ~* r.valor)
        or (r.tipo='patron_url' and coalesce(s.url,'') ~* r.valor)) limit 1) as regla_ambigua,
    exists (select 1 from reglas r where r.compuerta='entra_si_o_si' and r.tipo='patron_titulo'
      and s.txt ~* r.valor) as menciona_marca,
    (select r.id from reglas r where r.compuerta='no_entra_nunca'
      and ((r.tipo='patron_titulo' and s.txt ~* r.valor
            and not (r.valor ~ 'espa' and s.txt ~* 'argentin')
            and not (r.valor ~ 'volkswagen' and s.txt ~*
              '(enfermedad|vacuna|brote|sanidad|sanitari|zoonosis|parasit|garrapata|mastitis|bienestar animal)')
            and not (r.valor ~ 'senasa' and s.txt ~*
              '(aliment|nutricion|petfood|mascota|perro|gato|balanceado|golosina|chocolat|confiter|snack)'))
        or (r.tipo='patron_url' and coalesce(s.url,'') ~* r.valor)
        or (r.tipo='tld' and s.dominio_norm ~* r.valor)
        or (r.tipo='dominio' and s.dominio_norm ~* r.valor)) limit 1) as regla_tema,
    (s.fecha_confiable and s.fecha_pub < (select corte from cfg)
      - make_interval(hours=>(select ventana_h from cfg))) as es_vieja,
    (s.fecha_confiable and s.fecha_pub >= (select corte from cfg)) as fecha_futura,
    (length(coalesce(s.titulo,'')) < (select titulo_min from cfg)
      and length(coalesce(s.snippet,'')) < 20) as titulo_pobre,
    (s.fuente_monitoreada or s.fuente_tier is not null or s.tiene_keyword or s.viene_de_alerta) as tiene_ancla,
    (select min(c2.fecha) from public.candidatas_raw c2
      where c2.url_canonica=s.url_canonica and c2.fecha < (select fecha from param)) as primera_vez
  from suscritas s
), gated as (
  select e.*,
    (e.menciona_marca and e.regla_ambigua is null) as es_prioritaria,
    case
      when e.regla_ambigua is not null then 'desambiguacion'
      when e.fecha_futura then 'fecha_futura'
      when e.regla_tema is not null and not e.menciona_marca then 'regla_tema'
      when not e.tiene_ancla then 'sin_ancla_relevancia'
      when e.es_vieja then 'antiguedad'
      when (not e.fecha_confiable) and e.primera_vez is not null then 'vista_antes_sin_fecha'
      when e.titulo_pobre then 'titulo_pobre'
      else null
    end as gate
  from ev e
), deduped as (
  select g.*,
    case when g.gate is null then row_number() over (
      partition by g.dominio_norm,
        lower(regexp_replace(coalesce(g.titulo,''),'[^a-zA-Z0-9]+','','g'))
      order by g.es_prioritaria desc, g.fecha_confiable desc,
               g.fecha_pub desc nulls last, g.capturado_at) end as rn
  from gated g
), veredicto as (
  select d.*,
    coalesce(d.gate, case
      when d.rn > 1 then 'repetida_en_el_dia'
      when public.es_repetida_al(p_client_id, d.url_canonica, (select fecha from param)) then 'ya_enviada'
    end) as veredicto
  from deduped d
)
select v.id, v.url, v.url_canonica, v.titulo, v.dominio_norm, v.fecha_pub, v.es_prioritaria,
  v.veredicto,
  case v.veredicto
    when 'desambiguacion' then coalesce(rg.motivo,'la palabra parece la marca y no lo es')
    when 'regla_tema' then coalesce(rg.motivo,'el tema no le sirve al cliente')
    when 'sin_ancla_relevancia' then 'no tiene sitio monitoreado, tier, keyword, marca ni Google Alert asociado'
    when 'antiguedad' then 'publicada fuera de la ventana de '||(select ventana_h from cfg)||' h'
    when 'fecha_futura' then 'la fecha de publicacion cae despues del corte'
    when 'vista_antes_sin_fecha' then 'no trae fecha propia y ya estaba en el pool'
    when 'titulo_pobre' then 'titulo corto y sin copete'
    when 'repetida_en_el_dia' then 'el mismo medio ya publico esta nota en la corrida'
    when 'ya_enviada' then 'ya se le envio a este cliente en los 30 dias previos'
  end,
  rg.id,
  case
    when v.veredicto is null then null
    when v.veredicto in ('antiguedad','fecha_futura') then to_char(v.fecha_pub,'YYYY-MM-DD HH24:MI')
    when v.veredicto='vista_antes_sin_fecha' then v.primera_vez::text
    when v.veredicto='titulo_pobre' then v.titulo
    when v.veredicto='ya_enviada' then v.url_canonica
    when v.veredicto='repetida_en_el_dia' then v.dominio_norm
    else coalesce(v.dominio_norm, 'sin dominio')
  end
from veredicto v
left join reglas_filtro rg
  on rg.id = case when v.veredicto in ('desambiguacion','regla_tema')
                  then coalesce(v.regla_ambigua,v.regla_tema) end;
$function$;

-- El snapshot debe usar la preseleccion barata. El evaluador completo queda
-- disponible para auditoria, pero no vuelve a recorrer todo el pool antes de
-- cada corrida.
create or replace function public.v4_materializar_candidatas(
  p_run_id uuid,
  p_tope int default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $function$
declare
  v_run pipeline_runs%rowtype;
  v_nuevas integer := 0;
  v_total bigint := 0;
begin
  select * into v_run from public.pipeline_runs where id = p_run_id;
  if not found then
    raise exception 'pipeline_run no existe: %', p_run_id using errcode = '22023';
  end if;

  if v_run.pool_materializado_at is null then
    insert into public.pipeline_run_candidatas (run_id, candidata_id, orden, es_prioritaria)
    select p_run_id, x.candidata_id, x.orden, x.es_prioritaria
    from (
      select q.candidata_id, q.es_prioritaria,
        row_number() over (order by q.es_prioritaria desc, q.fecha_pub desc nulls last, q.candidata_id) as orden
      from public.v4_candidatas_aceptadas_rapido(v_run.client_id, v_run.fecha) q
    ) x
    where p_tope is null or x.orden <= greatest(1, p_tope)
    on conflict do nothing;

    get diagnostics v_nuevas = row_count;
    select count(*) into v_total from public.pipeline_run_candidatas where run_id = p_run_id;
    update public.pipeline_runs
       set pool_materializado_at = now(), pool_total = v_total, pool_es_muestra = p_tope is not null
     where id = p_run_id;
  end if;

  select coalesce(pool_total,0) into v_total from public.pipeline_runs where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'client_id',v_run.client_id,'fecha',v_run.fecha,
    'modo',v_run.modo,'candidatas_nuevas',v_nuevas,'candidatas',v_total,
    'candidatas_es_muestra',coalesce((select pool_es_muestra from public.pipeline_runs where id=p_run_id),false));
end;
$function$;

create or replace function public.v4_test_materializar_candidatas(
  p_run_id uuid,
  p_tope int default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'test', 'public'
set statement_timeout to '120s'
as $function$
declare
  v_run test.v4_pipeline_runs%rowtype;
  v_nuevas integer := 0;
  v_total bigint := 0;
begin
  select * into v_run from test.v4_pipeline_runs where id = p_run_id for update;
  if not found then raise exception 'corrida test inexistente: %', p_run_id using errcode = '22023'; end if;

  if v_run.pool_materializado_at is null then
    insert into test.v4_pipeline_run_candidatas (run_id,candidata_id,orden,es_prioritaria)
    select p_run_id,x.candidata_id,x.orden,x.es_prioritaria
    from (
      select q.candidata_id,q.es_prioritaria,
        row_number() over (order by q.es_prioritaria desc,q.fecha_pub desc nulls last,q.candidata_id) as orden
      from public.v4_candidatas_aceptadas_rapido(v_run.client_id,v_run.fecha) q
    ) x
    where p_tope is null or x.orden <= greatest(1,p_tope);

    get diagnostics v_nuevas = row_count;
    select count(*) into v_total from test.v4_pipeline_run_candidatas where run_id=p_run_id;
    update test.v4_pipeline_runs
       set pool_materializado_at=now(),pool_total=v_total,pool_es_muestra=p_tope is not null
     where id=p_run_id;
  else
    select coalesce(pool_total,0) into v_total from test.v4_pipeline_runs where id=p_run_id;
  end if;

  return jsonb_build_object('run_id',p_run_id,'client_id',v_run.client_id,'fecha',v_run.fecha,
    'modo','test','candidatas_nuevas',v_nuevas,'candidatas',v_total,
    'candidatas_es_muestra',coalesce((select pool_es_muestra from test.v4_pipeline_runs where id=p_run_id),false));
end;
$function$;

comment on function public.v4_materializar_candidatas(uuid,int) is
  'Materializa el pool rapido y estable; la ventana se corta diez minutos antes del cron de cada cliente.';
comment on function public.v4_test_materializar_candidatas(uuid,int) is
  'Version test del pool rapido; lee public pero solo escribe en test y nunca consume ni marca notas.';

grant execute on function public.v4_materializar_candidatas(uuid,int) to anon, authenticated, service_role;
grant execute on function public.v4_test_materializar_candidatas(uuid,int) to anon, authenticated, service_role;
