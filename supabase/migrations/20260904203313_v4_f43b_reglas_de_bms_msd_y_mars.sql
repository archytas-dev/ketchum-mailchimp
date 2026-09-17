-- [F4.3b] Reglas de BMS, MSD y Mars, leídas de sus workflows v3 (04/09).
--
-- Cada cliente las tiene en un nodo DISTINTO, que es por qué nadie las veía juntas:
--   BMS   -> 'Quality Guard PRE-AI'   (~220 patrones)
--   MSD   -> 'Quality Guard POST-AI'  (fuera de scope sanitario, policiales, evergreen)
--   Mars  -> 'Quality Guard POST-AI'  (desambiguación de marca, agro sin rubro, digest)
--   Booking -> 'Normalize + Dedup + Pre-filter'  (ya cargadas)
-- Los PRE-AI de MSD y Mars son passthrough byte a byte, los dos rotulados "BOOKING".
--
-- NO se migran ~160 reglas de la v3, y no es un olvido: la v4 solo trae lo que está en
-- el catálogo suscripto, mientras que la v3 además ingería el agregador (búsqueda
-- abierta) y por eso le entraba internet entero. Medido: 0 fuentes de agregador en v4,
-- y de 54 dominios extranjeros de la lista de BMS solo 12 están en el catálogo. Las
-- ~40 reglas que matchean por NOMBRE de medio existían solo porque la v3 no podía
-- resolver el dominio detrás del redirect; la v4 siempre sabe el dominio_norm.

insert into public.reglas_filtro (client_id, tipo, valor, compuerta, peso, motivo) values

-- ── GLOBALES: basura que no depende del cliente ─────────────────────────────
(null, 'patron_url',
 '(buscojobs|bebee\.|computrabajo|bumeran|zonajobs|glassdoor|indeed\.|jobrapido|kitempleo|talent\.com|neuvoo|opcionempleo|jooble|laborum|randstad|whatjobs|joblift|hosco\.|linkedin\.com/jobs|trabajando\.cl|chiletrabajos)',
 'no_entra_nunca', 0,
 'Portal de empleo. Un aviso de trabajo no es cobertura de prensa. Lista de Mars, que es la más completa de los cuatro'),

(null, 'patron_titulo',
 '(b[uú]squeda laboral|aviso de empleo|oferta de empleo|postul[aá](te|r)|envi[aá] tu cv|sumate al equipo|we are (hiring|looking)|now hiring|job opening|\yvirtual assistant\y)',
 'no_entra_nunca', 0,
 'Aviso de empleo por el título, para los que no vienen de un portal de empleo'),

(null, 'patron_titulo',
 '(no pudimos encontrar|no se encontr|p[aá]gina no encontrada|sin resultados|404 not found)',
 'no_entra_nunca', 0,
 'Página de error scrapeada como si fuera una nota'),

(null, 'patron_url',
 '(tuquejasuma|defensadelconsumidor|reclamos\.com|reclamosonline|libroreclamaciones|libroquejas|quejasonline|opinionesempresas|trustpilot\.|sitejabber|pissedconsumer)',
 'no_entra_nunca', 0,
 'Sitio de reclamos de consumidores: no es prensa'),

(null, 'patron_url', '(studocu|scribd|academia\.edu|coursehero|slideshare|docsity)\.',
 'no_entra_nunca', 0,
 'Repositorio de documentos: apuntes y PDFs subidos, no notas'),

(null, 'patron_url', '(/default\.(asp|php|html?)([?#]|$)|/feeds/[^/]+/comments/)',
 'no_entra_nunca', 0,
 'La URL apunta a una home o a un feed de comentarios, no a una nota'),

-- ── BMS ─────────────────────────────────────────────────────────────────────
((select id from public.clients where slug = 'bms'), 'patron_titulo',
 '(\yAlejandro\s+Roemmers\y|Roemmers.*\y(poema|poes[ií]a|escritor|literatura|recital|libro)\y|\y(poema|poes[ií]a|recital|literatura)\y.*Roemmers)',
 'no_entra_nunca', 0,
 'El escritor Alejandro Roemmers, no el laboratorio. Es el caso testigo de por qué las reglas tienen que ser datos: en JavaScript nadie sabe por qué está'),

((select id from public.clients where slug = 'bms'), 'patron_titulo',
 'ANMAT.*(producto?s?\s+capilar|alisad[o]?\s+capilar|insecticida|espiral(es)?\s+(para\s+)?mosquitos?|anti[\s-]mufa|desodorante\s+de?\s+ambiente|domisanitario|producto\s+de\s+limpieza|esmalt|gel\s+semi|cosm[eé]tic)',
 'no_entra_nunca', 0,
 'ANMAT también regula cosméticos y domisanitarios: esas prohibiciones no son noticia farmacéutica'),

((select id from public.clients where slug = 'bms'), 'patron_titulo',
 '(\yex\s*jugador.*\y(nba|nfl|nhl)\y|jugador\s+de\s+la\s+nba|vida\s+en\s+hollywood|Mart[ií]n\s+Fierro|^\s*Clima\s+en\s+|pron[oó]stico\s+del\s+(clima|tiempo))',
 'no_entra_nunca', 0,
 'Deportes, espectáculos y clima: entraban por coincidencia de palabra clave'),

((select id from public.clients where slug = 'bms'), 'patron_titulo',
 '(A[NnÑñ][Oo]\s+DE\s+LA\s+GRANDEZA\s+ARGENTINA|^\s*Disposici[oó]n\s+autorizante\s+N|CERTIFICADO\s+DE\s+AUTORIZACI[OÓ]N\s*$|^\s*DI-\d{4}-\d+-APN)',
 'no_entra_nunca', 0,
 'Texto crudo de un PDF de disposición de ANMAT, no una nota'),

((select id from public.clients where slug = 'bms'), 'patron_titulo',
 '(campa[ñn]a\s+para\s+sumar\s+donantes|jornadas?\s+para\s+promover\s+la\s+donaci|realizar[aá]n?\s+jornadas?\s+de\s+vacunaci[oó]n\s+(en\s+barrio|en\s+el\s+barrio|en\s+la\s+plaza|local|municipal|gratuit)|Municipalidad\s+(contin[uú]a|sigue).*(vacunaci[oó]n|control\s+m[eé]dico))',
 'no_entra_nunca', 0,
 'Agenda institucional o municipal sin novedad terapéutica'),

((select id from public.clients where slug = 'bms'), 'patron_titulo',
 '(bristol[-\s]?myers|\ybms\y|opdivo|sotyktu|yervoy|breyanzi|sprycel|reblozyl|orencia|onureg|camzyos|opdualag|nivolumab|ipilimumab|deucravacitinib|dasatinib|luspatercept|abatacept|mavacamten|relatlimab)',
 'entra_si_o_si', 0,
 'Marca o molécula del cliente: entra sí o sí, y queda exenta de los filtros geográficos'),

-- ── MSD ─────────────────────────────────────────────────────────────────────
((select id from public.clients where slug = 'msd'), 'patron_titulo', '(\ymsd\y|allflex|bravecto)',
 'entra_si_o_si', 0,
 'Marca o producto del cliente: nunca se descarta una mención directa a MSD'),

((select id from public.clients where slug = 'msd'), 'patron_titulo',
 '\y(imputan|imputaron|denunciaron|denuncian|detuvieron|arrestaron|condenaron)\y.*(\yanimal(es)?\y|\yperro|\ygato|\ycanes\y)',
 'no_entra_nunca', 0,
 'Policial o judicial sobre animales, sin eje de salud pública'),

((select id from public.clients where slug = 'msd'), 'patron_titulo', '\yrescataron a\y.*(\yperro|\ygato\y)',
 'no_entra_nunca', 0,
 'Interés humano: rescate de mascota, sin novedad sanitaria'),

((select id from public.clients where slug = 'msd'), 'patron_titulo',
 '^(videos?|fotos?|podcast)\y|\yfm\s*\d{2,3}([.,]\d)?\y|radio\s*&?\s*stream',
 'no_entra_nunca', 0,
 'Contenido evergreen sin fecha real: página de videos, podcast o stream de radio'),

((select id from public.clients where slug = 'msd'), 'patron_titulo',
 '\y(volkswagen|ford|toyota|chevrolet|renault|fiat|peugeot|amarok|hilux|pickup)\y',
 'no_entra_nunca', 0,
 'Automotriz. MSD es sanidad animal: solo descarta si además no hay eje sanitario, y esa condición la aplica normalizar_y_compuertas()'),

-- ── MARS ────────────────────────────────────────────────────────────────────
((select id from public.clients where slug = 'mars'), 'patron_titulo',
 '(\ybruno\s+mars\y|\yvmas\y|video\s+music\s+awards|\yhbo\s*max\y|\ynetflix\y|casa\s+de\s+los\s+famosos|\yfar[aá]ndula\y|nominados?\s+a\s+(los\s+)?(vmas|grammy|oscar)|serie\s+de\s+(hbo|netflix|streaming)|colonia\s+(habitada\s+)?en\s+marte|planeta\s+marte)',
 'no_entra_nunca', 0,
 'Desambiguación de marca: Bruno Mars, los VMAs y el planeta Marte no son el cliente. Es la regla más específica de los cuatro clippings'),

((select id from public.clients where slug = 'mars'), 'patron_url',
 '(momentodecampo|vetmarketportal|soloavesyporcinos|elproductorporcino|interempresas|globalfarma)',
 'no_entra_nunca', 0,
 'Página de listado multi-fecha, no una nota individual. Se aplica incluso a sitios curados por el cliente: vetmarketportal está cargado como monitoreado de Mars y necesita el bloqueo igual'),

((select id from public.clients where slug = 'mars'), 'patron_titulo',
 '(\ysenasa\y|\ysturzenegger\y|retencion(es)?\y|arancel(es)?\y|exportaci[oó]n(es)? de (carne|granos|soja|trigo|maiz)|\yzafra\y|\ycosecha\y|\ysiembra\y|\yfeedlot\y|\yfrigorifico\y)',
 'no_entra_nunca', 0,
 'Agro comercial o regulatorio. Solo descarta si NO hay rubro del cliente (alimento, mascota, petfood, confitería): la excepción la aplica normalizar_y_compuertas(). Los sitios de agro se comparten con otros clippings'),

((select id from public.clients where slug = 'mars'), 'patron_titulo',
 '(\ymars\y|pedigree|whiskas|petfood|balanceado)',
 'entra_si_o_si', 0,
 'Marca del cliente. OJO: choca a propósito con la regla de farándula, que se evalúa igual porque "Bruno Mars" también contiene "mars" — el orden de las compuertas lo resuelve');
