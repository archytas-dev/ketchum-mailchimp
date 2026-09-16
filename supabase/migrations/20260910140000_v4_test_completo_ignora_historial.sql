-- El modo test/golden diff debe poder ver el clipping completo aun cuando la
-- v3 o una corrida anterior ya haya escrito esas URLs al historial público.
-- Mantiene ventana, fuentes y filtros de relevancia; solo omite el dedup de
-- enviados. Las escrituras siguen confinadas al schema test.

create or replace function public.v4_candidatas_aceptadas_rapido(
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
with param as (
  select p_fecha::date as fecha
), reglas as materialized (
  select rf.* from public.reglas_filtro rf
  where rf.activa and (rf.client_id is null or rf.client_id = p_client_id)
), cfg as (
  select
    coalesce((select max(valor::int) from reglas where tipo = 'antiguedad'), 24) as ventana_h,
    coalesce((select max(valor::int) from reglas where tipo = 'titulo_corto'), 25) as titulo_min,
    public.v4_corte_cliente_art(p_client_id, (select fecha from param)) as corte
), monitoreadas as materialized (
  select distinct
    m.client_id,
    lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) as dominio_norm
  from public.medios m
  where m.activo and m.tipo = 'monitoreado'
), fuentes_cliente as materialized (
  select f.id as fuente_id,
    max(s.tier) as fuente_tier,
    bool_or(mon.dominio_norm is not null) as fuente_monitoreada
  from public.medios_suscripcion s
  join public.medios_fuentes f on f.id = s.fuente_id and f.activa
  left join monitoreadas mon on mon.client_id = s.client_id and mon.dominio_norm = f.dominio_norm
  where s.client_id = p_client_id
    and coalesce(s.bloqueado, false) = false
    and (s.tier is not null or mon.dominio_norm is not null)
  group by f.id
), suscritas as materialized (
  select c.*, fc.fuente_tier, fc.fuente_monitoreada, false as viene_de_alerta,
    (coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) as txt
  from public.candidatas_raw c
  join fuentes_cliente fc on fc.fuente_id = c.fuente_id
  where c.alerta_id is null
    and c.fecha between (select fecha from param) - 1 and (select fecha from param)
    and (
      (c.fecha_confiable and c.fecha_pub >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg)) and c.fecha_pub < (select corte from cfg))
      or ((not c.fecha_confiable or c.fecha_pub is null) and c.capturado_at >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg)) and c.capturado_at < (select corte from cfg))
    )
  union all
  select c.*, null::int as fuente_tier, false as fuente_monitoreada, true as viene_de_alerta,
    (coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) as txt
  from public.candidatas_raw c
  join public.google_alerts ga on ga.id = c.alerta_id and ga.client_id = p_client_id and ga.activa
  where c.fecha between (select fecha from param) - 1 and (select fecha from param)
    and (
      (c.fecha_confiable and c.fecha_pub >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg)) and c.fecha_pub < (select corte from cfg))
      or ((not c.fecha_confiable or c.fecha_pub is null) and c.capturado_at >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg)) and c.capturado_at < (select corte from cfg))
    )
), base as materialized (
  select s.*,
    exists (select 1 from reglas r where r.compuerta = 'entra_si_o_si' and r.tipo = 'patron_titulo' and s.txt ~* r.valor) as marca,
    (s.fecha_confiable and s.fecha_pub < (select corte from cfg) - make_interval(hours => (select ventana_h from cfg))) as vieja,
    (s.fecha_confiable and s.fecha_pub >= (select corte from cfg)) as futura,
    (length(coalesce(s.titulo, '')) < (select titulo_min from cfg) and length(coalesce(s.snippet, '')) < 20) as titulo_pobre
  from suscritas s
), filtradas as (
  select b.*,
    exists (select 1 from reglas r where r.compuerta = 'desambiguacion' and ((r.tipo = 'patron_titulo' and b.txt ~* r.valor) or (r.tipo = 'patron_url' and coalesce(b.url, '') ~* r.valor))) as ambigua,
    exists (
      select 1 from reglas r where r.compuerta = 'no_entra_nunca' and (
        (r.tipo = 'patron_titulo' and b.txt ~* r.valor
          and not (r.valor ~ 'espa' and b.txt ~* 'argentin')
          and not (r.valor ~ 'volkswagen' and b.txt ~* '(enfermedad|vacuna|brote|sanidad|sanitari|zoonosis|parasit|garrapata|mastitis|bienestar animal)')
          and not (r.valor ~ 'senasa' and b.txt ~* '(aliment|nutricion|petfood|mascota|perro|gato|balanceado|golosina|chocolat|confiter|snack)'))
        or (r.tipo = 'patron_url' and coalesce(b.url, '') ~* r.valor)
        or (r.tipo = 'tld' and coalesce(b.dominio_norm, '') ~* r.valor)
        or (r.tipo = 'dominio' and coalesce(b.dominio_norm, '') ~* r.valor)
      )
    ) as tema_descartado
  from base b
), pasan_compuerta as (
  select f.*, (f.marca or f.viene_de_alerta) and not f.ambigua as es_prioritaria
  from filtradas f
  where not f.ambigua and (f.marca or not f.tema_descartado)
    and (f.marca or f.viene_de_alerta or not f.vieja and not f.futura and not f.titulo_pobre)
), sin_repetida_del_dia as (
  select p.*, row_number() over (
    partition by p.dominio_norm, lower(regexp_replace(coalesce(p.titulo, ''), '[^a-zA-Z0-9]+', '', 'g'))
    order by p.es_prioritaria desc, p.fecha_confiable desc, p.fecha_pub desc nulls last, p.capturado_at
  ) as rn
  from pasan_compuerta p
), aceptadas as (
  select p.*
  from sin_repetida_del_dia p
  left join public.notas_historico_url h on h.client_id = p_client_id and h.url_norm = p.url_canonica
    and h.primera_vez_fecha >= (select fecha from param) - 30
  where p.rn = 1 and (not p_respetar_historial or h.id is null)
)
select id, es_prioritaria, fecha_pub from aceptadas;
$function$;

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
  select lower(coalesce(slug, '')) as slug from public.clients where id = p_client_id
), reglas as materialized (
  select rf.* from public.reglas_filtro rf where rf.activa and (rf.client_id = p_client_id or rf.client_id is null)
), keywords as materialized (
  select public.v4_keyword_norm(k.keyword) as keyword_norm
  from public.kw_keywords k
  where k.client_id = p_client_id and k.activa and nullif(public.v4_keyword_norm(k.keyword), '') is not null
), candidatas as materialized (
  select q.candidata_id, q.fecha_pub, c.titulo, c.alerta_id
  from public.v4_candidatas_aceptadas_rapido(p_client_id, p_fecha, p_respetar_historial) q
  join public.candidatas_raw c on c.id = q.candidata_id
), normalizadas as materialized (
  select c.*, public.v4_keyword_norm(coalesce(c.titulo, '')) as titulo_norm from candidatas c
), aceptadas as (
  select c.*,
    exists (select 1 from keywords k where (' ' || c.titulo_norm || ' ') like ('% ' || k.keyword_norm || ' %')) as tiene_keyword_titulo,
    exists (select 1 from keywords k where (' ' || c.titulo_norm || ' ') like ('% ' || k.keyword_norm || ' %') and not ((select slug from cliente) = 'mars' and k.keyword_norm = 'inflacion')) as tiene_keyword_no_generica,
    exists (select 1 from reglas r where r.compuerta = 'entra_si_o_si' and r.tipo = 'patron_titulo' and coalesce(c.titulo, '') ~* r.valor) as tiene_marca_titulo
  from normalizadas c
)
select a.candidata_id, a.tiene_marca_titulo as es_prioritaria, a.fecha_pub
from aceptadas a
where a.tiene_marca_titulo or a.tiene_keyword_no_generica or (a.tiene_keyword_titulo and (select slug from cliente) <> 'mars');
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
  select * into v_run from test.v4_pipeline_runs where id=p_run_id for update;
  if not found then raise exception 'corrida test inexistente: %', p_run_id using errcode='22023'; end if;
  if v_run.pool_materializado_at is null then
    insert into test.v4_pipeline_run_candidatas(run_id,candidata_id,orden,es_prioritaria)
    select p_run_id,x.candidata_id,x.orden,x.es_prioritaria
    from (
      select q.candidata_id,q.es_prioritaria,
        row_number() over(order by q.es_prioritaria desc,q.fecha_pub desc nulls last,q.candidata_id) as orden
      from public.v4_candidatas_aceptadas_operativo(v_run.client_id,v_run.fecha,false) q
    ) x
    where p_tope is null or x.orden <= greatest(1,p_tope);
    get diagnostics v_nuevas = row_count;
    select count(*) into v_total from test.v4_pipeline_run_candidatas where run_id=p_run_id;
    update test.v4_pipeline_runs set pool_materializado_at=now(),pool_total=v_total,pool_es_muestra=p_tope is not null where id=p_run_id;
  else
    select coalesce(pool_total,0) into v_total from test.v4_pipeline_runs where id=p_run_id;
  end if;
  return jsonb_build_object('run_id',p_run_id,'client_id',v_run.client_id,'fecha',v_run.fecha,
    'modo','test','candidatas_nuevas',v_nuevas,'candidatas',v_total,
    'candidatas_es_muestra',coalesce((select pool_es_muestra from test.v4_pipeline_runs where id=p_run_id),false),
    'ignora_historial_publico',true);
end;
$function$;

comment on function public.v4_test_materializar_candidatas(uuid,int) is
  'Test/golden diff: lee el pool público, aplica filtros de fuentes, fecha y relevancia, pero ignora solo el historial de enviados. Escribe exclusivamente en test.';

grant execute on function public.v4_candidatas_aceptadas_rapido(uuid,date,boolean) to anon, authenticated, service_role;
grant execute on function public.v4_candidatas_aceptadas_operativo(uuid,date,boolean) to anon, authenticated, service_role;
grant execute on function public.v4_test_materializar_candidatas(uuid,int) to anon, authenticated, service_role;
