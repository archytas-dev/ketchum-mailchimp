-- [F4.3] Las reglas de la v3 viven como JavaScript adentro de un nodo de ~300 líneas,
-- repetido en 4 workflows. Acá pasan a ser datos: una fila por regla, con su motivo.
-- Traducidas leyendo 'Normalize + Dedup + Pre-filter' del clipping de Booking (04/09).
--
-- Las tres compuertas del design doc:
--   entra_si_o_si  -> ninguna otra regla la puede sacar
--   no_entra_nunca -> descarte duro, sobre la fuente y los hechos
--   puntua         -> suma o resta, no decide sola
--
-- Lo que NO va acá: la deduplicación por título (Jaccard intra y cross-medio) no es una
-- regla de filtro, es dedup — vive en normalizar_y_compuertas().

-- 'titulo_corto' es un tipo que la Fase 1 no previó y que la v3 sí aplica.
alter table public.reglas_filtro drop constraint reglas_filtro_tipo_check;
alter table public.reglas_filtro add constraint reglas_filtro_tipo_check
  check (tipo in ('dominio','patron_titulo','patron_url','tld','idioma',
                  'antiguedad','seccion_url','titulo_corto'));

insert into public.reglas_filtro (client_id, tipo, valor, compuerta, peso, motivo) values

-- ── GLOBALES ────────────────────────────────────────────────────────────────
(null, 'patron_titulo', '!\[', 'no_entra_nunca', 0,
 'El título trae sintaxis de imagen de markdown: viene roto del scraping, no es una nota'),

(null, 'patron_titulo', '(vende acciones|holdings|\yevp\y|\yshares\y)', 'no_entra_nunca', 0,
 'Ruido financiero corporativo. Estaba hardcodeado en el flujo de Booking aunque parece copiado del de BMS: es el arrastre que esta tabla viene a hacer visible'),

(null, 'tld', '\.(py|es|com\.mx|com\.pe|com\.co|com\.bo|com\.cl|com\.br)$', 'no_entra_nunca', 0,
 'Dominio de otro país. Los clippings son de prensa argentina; la nota extranjera es el reporte "fuente extranjera"'),

(null, 'antiguedad', '24', 'no_entra_nunca', 0,
 'Más de 24 h de publicada. La v3 usó 72 h los lunes y se fijó en 24 h el 08/07. Una fecha NO confiable no activa esta regla: no se descarta por antigüedad lo que no se sabe cuándo se publicó'),

(null, 'titulo_corto', '25', 'no_entra_nunca', 0,
 'Título de menos de 25 caracteres y sin copete: suele ser un link de menú o una home institucional ("Ministerio de Salud"), no una nota'),

-- ── BOOKING ─────────────────────────────────────────────────────────────────
((select id from public.clients where slug = 'booking'), 'patron_url', '//(www\.)?booking\.com/', 'no_entra_nunca', 0,
 'La nota apunta al sitio del propio cliente: es su web, no cobertura de prensa'),

((select id from public.clients where slug = 'booking'), 'dominio', '^(booking|booking\.com|news booking)$', 'no_entra_nunca', 0,
 'El medio publicador ES el cliente (su comunicado entrando por el agregador), no un tercero cubriéndolo'),

((select id from public.clients where slug = 'booking'), 'patron_titulo', '\ybooking\y', 'entra_si_o_si', 0,
 'Menciona la marca del cliente: entra sí o sí. Ni el filtro de keywords ni la dedup cross-medio la pueden sacar — cada medio que la publica es un placement distinto'),

((select id from public.clients where slug = 'booking'), 'patron_titulo',
 '(español(es|a|as)?|en españa|desde españa|mercado español|mexicanos?|en m[eé]xico|mercado mexicano|los europeos|mercado europeo|brit[aá]nicos?|alemanes|franceses|italianos|los chinos|los japoneses)',
 'no_entra_nunca', 0,
 'Nota sobre el cliente en otro mercado. Solo descarta si además NO dice "argentin": esa excepción la aplica normalizar_y_compuertas(), no se puede expresar en un regex solo');

comment on table public.reglas_filtro is
  'Las reglas de filtrado como datos, una por fila, con el motivo escrito. Reemplazan al JavaScript repartido en 3 nodos x 4 workflows de la v3. descartes_acumulados y reclamos_asociados los mueve el dashboard: a los 3 reclamos la regla queda marcada para revisar.';
