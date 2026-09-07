-- Fase 4 · primer paso: detectar índices históricos.
--
-- El problema medido el 04/09: 5 dominios metieron 16.084 notas sin fecha — el 74% de
-- todo lo sin fechar y el 31% del pool. maracodigital.net solo aportó 12.001. Su
-- sitemap tiene 12.003 URLs y CERO <lastmod>: es el archivo histórico del sitio, no
-- las noticias del día.
--
-- No se puede arreglar resolviendo fechas: no hay de dónde sacarlas. Verificado —
-- no tienen /feed/ ni sitemap-news (404 en los tres), y la URL tampoco las trae
-- (42 de 21.770 con patrón de fecha). La única salida sería abrir cada nota, y son
-- 16.000 por barrido.
--
-- REGLA: el criterio es volumen SIN FECHAS, nunca volumen solo. elmonterizo.com trae
-- 3.841 notas y las 3.841 tienen fecha, 3.658 de las últimas 48 h: es una fuente
-- legítima y prolífica. Marcarla por volumen habría sido un error caro.

create or replace view public.v4_indices_historicos as
with x as (
  select
    c.dominio_norm,
    count(*)                                        as notas,
    count(*) filter (where c.fecha_confiable)       as con_fecha,
    count(*) filter (where c.fecha_confiable
                       and c.fecha_pub >= now() - interval '7 days') as recientes,
    max(c.fecha)                                    as ultimo_dia
  from public.candidatas_raw c
  where c.fecha >= current_date - 2
  group by 1
)
select
  x.dominio_norm,
  x.notas,
  x.con_fecha,
  x.recientes,
  round(100.0 * x.con_fecha / nullif(x.notas, 0)) as pct_con_fecha,
  e.formato,
  e.transporte,
  coalesce(e.url_recurso, f.url_feed)             as url,
  x.ultimo_dia
from x
join public.medios_fuentes    f on f.dominio_norm = x.dominio_norm and f.activa is true
join public.medios_estrategia e on e.dominio_norm = x.dominio_norm
-- Volumen alto Y prácticamente nada fechado. Las dos condiciones, siempre.
where x.notas >= 300
  and x.con_fecha <= greatest(5, x.notas * 0.02)
order by x.notas desc;

comment on view public.v4_indices_historicos is
  'Fuentes que vuelcan un archivo histórico en vez de las noticias del día: mucho volumen (300+) y casi nada fechado (<=2%). El criterio es volumen SIN FECHAS, nunca volumen solo — elmonterizo.com trae 3.841 notas todas fechadas y es legítima. Estas fuentes no se arreglan resolviendo fechas: no hay de dónde sacarlas. Van a revisión de configuración (buscarles el feed real) o a baja.';
