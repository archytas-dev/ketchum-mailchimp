-- [F3.5] Cierre de cobertura y reporte por barrido.
--
-- Son VISTAS, no escrituras: fetch_log ya tiene un renglón por intento, así que el
-- reporte es una consulta, no un dato nuevo que haya que mantener sincronizado.
--
-- Y son vistas y no avisos: el reporte se consulta, no se manda. (El ticket original
-- decía "+ aviso a Slack"; la instrucción vigente es que nada salga hacia afuera.)
--
-- Por qué el recolector NO escribe en pipeline_runs / stage_events: el ledger modela
-- "una corrida de un cliente" — pipeline_runs.client_id es NOT NULL y la clave es
-- (client_id, fecha, modo). El recolector es compartido desde la decisión 6, así que
-- no le corresponde. El ledger es del armado por cliente (Fase 6).

create or replace view public.v4_barrido_resumen as
select
  l.fecha,
  l.pasada,
  min(l.ts)                                             as arranco,
  max(l.ts)                                             as termino,
  round(extract(epoch from (max(l.ts) - min(l.ts))))    as duracion_seg,
  count(*)                                              as fuentes,
  count(*) filter (where l.diagnostico = 'ok')          as ok,
  round(100.0 * count(*) filter (where l.diagnostico = 'ok')
        / nullif(count(*) filter (where l.diagnostico <> 'no_visitado'), 0)) as pct_ok_de_las_visitadas,
  sum(l.articulos)                                      as notas_traidas,
  sum(l.con_fecha)                                      as notas_con_fecha,
  -- las que ni se intentaron: html sin camino + brightdata sin conectar
  count(*) filter (where l.diagnostico = 'no_visitado')  as no_visitadas,
  -- fallas que la escalera puede resolver -> las toma v4_estrategia_a_reverificar
  count(*) filter (where l.diagnostico in ('bloqueado','caido','timeout','rate_limit','error')) as fallas_recuperables,
  -- feed válido y vacío: NO es una falla (decisión 11)
  count(*) filter (where l.diagnostico = 'sin_items')    as feeds_vacios,
  count(*) filter (where l.diagnostico in ('no_es_feed','no_existe')) as mal_apuntadas
from public.fetch_log l
where l.pasada like 'barrido_%'
group by l.fecha, l.pasada
order by l.fecha desc, l.pasada desc;

comment on view public.v4_barrido_resumen is
  'Cómo salió cada barrido: una fila por ventana. pct_ok_de_las_visitadas excluye las no_visitado del denominador, porque contarlas como falla mezcla "no anduvo" con "todavía no se intenta".';


create or replace view public.v4_cobertura_dia as
select
  fecha,
  count(distinct pasada)                                        as barridos,
  count(distinct fuente_id)                                     as fuentes_tocadas,
  count(distinct fuente_id) filter (where diagnostico = 'ok')    as fuentes_con_notas,
  count(distinct fuente_id) filter (where diagnostico = 'no_visitado') as fuentes_no_visitadas,
  -- fuentes que se intentaron todo el día y nunca dieron nada: el síntoma que
  -- importa. Una que falla un barrido no es noticia; una que falla los nueve, sí.
  count(distinct fuente_id) filter (where diagnostico <> 'ok')
    - count(distinct fuente_id) filter (where diagnostico = 'ok'
        and fuente_id in (select fuente_id from public.fetch_log l2
                          where l2.fecha = f.fecha and l2.diagnostico <> 'ok')) as aprox_solo_fallas,
  (select count(*) from public.candidatas_raw c where c.fecha = f.fecha)        as pool,
  (select count(*) from public.candidatas_raw c where c.fecha = f.fecha and c.fecha_confiable) as pool_con_fecha
from public.fetch_log f
where pasada like 'barrido_%'
group by fecha
order by fecha desc;

comment on view public.v4_cobertura_dia is
  'Rollup del día: cuántos barridos corrieron, cuántas fuentes dieron notas alguna vez y cuánto pool quedó. El pool es crudo: las compuertas de la Fase 4 son las que filtran.';


create or replace view public.v4_fuentes_mudas as
select
  f.id            as fuente_id,
  f.dominio_norm,
  e.transporte,
  e.metodo_extraccion,
  c.ritmo_publicacion_semanal,
  max(l.ts) filter (where l.diagnostico = 'ok')  as ultimo_ok,
  count(*) filter (where l.diagnostico = 'ok')   as barridos_ok_14d,
  count(*)                                       as intentos_14d,
  mode() within group (order by l.diagnostico)   as diagnostico_mas_comun
from public.medios_fuentes f
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
join public.medios_catalogo   c on c.dominio_norm = f.dominio_norm
left join public.fetch_log    l on l.fuente_id = f.id
                               and l.pasada like 'barrido_%'
                               and l.ts > now() - interval '14 days'
where f.activa is true
  and e.transporte is not null          -- se supone que anda: si no da notas, hay que mirar
  and e.metodo_extraccion = 'feed'
group by f.id, f.dominio_norm, e.transporte, e.metodo_extraccion, c.ritmo_publicacion_semanal
having count(*) filter (where l.diagnostico = 'ok') = 0
order by c.ritmo_publicacion_semanal desc nulls last, f.dominio_norm;

comment on view public.v4_fuentes_mudas is
  'Fuentes con transporte que se supone que funciona y que en 14 días no trajeron una sola nota. Ordenadas por ritmo de publicación: un medio que publica 50 notas por semana y está mudo es un problema; uno que publica una cada tanto, no. Es el aviso de los 14 días en cero que pide la pantalla de salud de fuentes (Fase 7).';
