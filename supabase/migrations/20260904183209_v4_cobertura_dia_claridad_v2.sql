-- La primera version tenia una columna 'aprox_solo_fallas' calculada con una
-- subconsulta correlacionada adentro de un agregado sobre la misma tabla: daba el
-- numero correcto de casualidad y era ilegible. Un nombre que arranca con 'aprox_'
-- es la señal de que quien lo escribio no confiaba en el.
--
-- Se dropea antes de recrear porque cambian nombres de columna, y CREATE OR REPLACE
-- VIEW no permite renombrar.

drop view if exists public.v4_cobertura_dia;

create view public.v4_cobertura_dia as
with x as (
  select
    l.fecha,
    count(distinct l.pasada)                                        as barridos,
    count(distinct l.fuente_id)                                     as fuentes_tocadas,
    count(distinct l.fuente_id) filter (where l.diagnostico = 'ok') as fuentes_con_notas,
    -- Las que NUNCA se intentaron en el dia. Se descuentan las que ademas dieron
    -- notas en otro barrido, para no contarlas dos veces.
    count(distinct l.fuente_id) filter (
      where l.diagnostico = 'no_visitado'
        and l.fuente_id not in (select l2.fuente_id from public.fetch_log l2
                                where l2.fecha = l.fecha and l2.diagnostico = 'ok')
    ) as no_visitadas
  from public.fetch_log l
  where l.pasada like 'barrido_%'
  group by l.fecha
)
select
  x.fecha,
  x.barridos,
  x.fuentes_tocadas,
  x.fuentes_con_notas,
  x.no_visitadas,
  -- El numero que importa: se intentaron todo el dia y nunca dieron una nota.
  -- Una fuente que falla un barrido no es noticia; una que falla los nueve, si.
  x.fuentes_tocadas - x.fuentes_con_notas - x.no_visitadas as visitadas_sin_notas,
  round(100.0 * x.fuentes_con_notas / nullif(x.fuentes_tocadas - x.no_visitadas, 0)) as pct_cobertura,
  (select count(*) from public.candidatas_raw c where c.fecha = x.fecha) as pool,
  (select count(*) from public.candidatas_raw c where c.fecha = x.fecha and c.fecha_confiable) as pool_con_fecha
from x
order by x.fecha desc;

comment on view public.v4_cobertura_dia is
  'Rollup del dia. visitadas_sin_notas es la señal que importa: fuentes que se intentaron y nunca dieron nada en todo el dia. no_visitadas son las que ni se intentan (html sin sub/open-article + brightdata sin conectar) y salen del denominador de pct_cobertura, porque contarlas como falla mezcla "no anduvo" con "todavia no se intenta". El pool es crudo: las compuertas de la Fase 4 son las que filtran.';
