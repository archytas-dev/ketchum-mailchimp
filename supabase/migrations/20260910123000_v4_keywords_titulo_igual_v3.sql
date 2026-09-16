-- Igual que la v3: la keyword que habilita una nota se busca en el TITULO.
-- El snippet queda para completar la descripción y para el juicio del A2; no
-- puede habilitar por sí solo una nota porque muchas páginas traen texto de
-- navegación, footer o recomendaciones ajenas al título.

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
         c.titulo, c.snippet, c.alerta_id
  from public.v4_candidatas_aceptadas_rapido(p_client_id, p_fecha) q
  join public.candidatas_raw c on c.id = q.candidata_id
), con_titulo_normalizado as materialized (
  select c.*,
         public.v4_keyword_norm(coalesce(c.titulo, '')) as titulo_norm
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
      where ga.id = c.alerta_id
        and ga.client_id = p_client_id
        and ga.activa
    ) as viene_de_alerta
  from con_titulo_normalizado c
)
select a.candidata_id,
       (a.es_prioritaria or a.tiene_marca_titulo or a.viene_de_alerta) as es_prioritaria,
       a.fecha_pub
from aceptadas a
where a.tiene_keyword_titulo or a.tiene_marca_titulo or a.viene_de_alerta;
$function$;

comment on function public.v4_candidatas_aceptadas_operativo(uuid, date) is
  'Capa final del pool diario: keyword en titulo, marca en titulo o Google Alert. El snippet no habilita notas.';

grant execute on function public.v4_candidatas_aceptadas_operativo(uuid, date)
  to anon, authenticated, service_role;

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
  v_run public.pipeline_runs%rowtype;
  v_nuevas integer := 0;
  v_total bigint := 0;
begin
  select * into v_run from public.pipeline_runs where id = p_run_id;
  if not found then raise exception 'pipeline_run no existe: %', p_run_id using errcode = '22023'; end if;
  if v_run.pool_materializado_at is null then
    insert into public.pipeline_run_candidatas (run_id, candidata_id, orden, es_prioritaria)
    select p_run_id, x.candidata_id, x.orden, x.es_prioritaria
    from (
      select q.candidata_id, q.es_prioritaria,
        row_number() over (order by q.es_prioritaria desc, q.fecha_pub desc nulls last, q.candidata_id) as orden
      from public.v4_candidatas_aceptadas_operativo(v_run.client_id, v_run.fecha) q
    ) x
    where p_tope is null or x.orden <= greatest(1, p_tope)
    on conflict do nothing;
    get diagnostics v_nuevas = row_count;
    select count(*) into v_total from public.pipeline_run_candidatas where run_id = p_run_id;
    update public.pipeline_runs set pool_materializado_at=now(),pool_total=v_total,pool_es_muestra=p_tope is not null
      where id=p_run_id;
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
  select * into v_run from test.v4_pipeline_runs where id=p_run_id for update;
  if not found then raise exception 'corrida test inexistente: %', p_run_id using errcode='22023'; end if;
  if v_run.pool_materializado_at is null then
    insert into test.v4_pipeline_run_candidatas(run_id,candidata_id,orden,es_prioritaria)
    select p_run_id,x.candidata_id,x.orden,x.es_prioritaria
    from (
      select q.candidata_id,q.es_prioritaria,
        row_number() over(order by q.es_prioritaria desc,q.fecha_pub desc nulls last,q.candidata_id) as orden
      from public.v4_candidatas_aceptadas_operativo(v_run.client_id,v_run.fecha) q
    ) x
    where p_tope is null or x.orden <= greatest(1,p_tope);
    get diagnostics v_nuevas = row_count;
    select count(*) into v_total from test.v4_pipeline_run_candidatas where run_id=p_run_id;
    update test.v4_pipeline_runs set pool_materializado_at=now(),pool_total=v_total,pool_es_muestra=p_tope is not null
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
  'Materializa el pool operativo: ventana de corte, fuente prioritaria y keyword/marca en titulo.';
comment on function public.v4_test_materializar_candidatas(uuid,int) is
  'Version test del pool operativo; todo lo escribible queda en test.';

grant execute on function public.v4_materializar_candidatas(uuid,int) to anon, authenticated, service_role;
grant execute on function public.v4_test_materializar_candidatas(uuid,int) to anon, authenticated, service_role;
