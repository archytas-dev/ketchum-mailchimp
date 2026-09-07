-- maracodigital.net y novaclima.com.ar no declaran news_sitemap y no se les encontró
-- ningún recurso con fechas. Su único sitemap es el archivo histórico completo:
-- 12.003 y 2.989 URLs sin un solo <lastmod>.
--
-- Entre las dos aportaban ~15.000 notas por barrido (el 29% del pool) que NO son del
-- día y que ninguna compuerta de fecha puede filtrar, porque no tienen fecha. Es el
-- riesgo "fecha fresca-falsa" del design doc en su forma más pura: un medio capaz de
-- empujar 12.000 notas viejas al filtro, todas pareciendo nuevas.
--
-- Se les quita el transporte, NO se desactiva la fuente. Así:
--   - salen de v4_recoleccion_pendientes (el recolector deja de traerlas)
--   - siguen visibles para el descubridor y para la pantalla de salud
--   - el día que se les encuentre un feed real, vuelven solas
-- Es reversible con un UPDATE y queda el motivo escrito.

update public.medios_estrategia
set transporte         = null,
    ultimo_diagnostico = 'indice_historico_sin_fechas',
    updated_at         = now()
where dominio_norm in ('maracodigital.net','novaclima.com.ar');

-- El pool de hoy ya está contaminado con esas ~15.000: se limpian. Son datos de
-- ingesta propios, de hoy, y el barrido siguiente ya no las va a traer.
delete from public.candidatas_raw
where fecha = current_date
  and dominio_norm in ('maracodigital.net','novaclima.com.ar');
