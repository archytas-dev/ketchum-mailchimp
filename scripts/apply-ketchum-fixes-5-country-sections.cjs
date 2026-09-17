const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${body.slice(0, 1600)}`);
  return body ? JSON.parse(body) : {};
}

const extractCode = String.raw`// Saca titulo, copete, FECHA y un fragmento corto del cuerpo de la pagina.
// El HTML completo muere dentro de fetch-page: solo este contexto acotado sigue
// viajeando al A2, para poder detectar pais sin volver a llenar la memoria.

function limpiar(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d{2,5});?/g, (m, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch (e) { return ' '; } })
    .replace(/&#x([0-9a-f]{2,4});?/gi, (m, n) => { try { return String.fromCharCode(parseInt(n, 16)); } catch (e) { return ' '; } })
    .replace(/&nbsp;?/gi,' ').replace(/&amp;?/gi,'&').replace(/&quot;?/gi,'"')
    .replace(/&apos;?/gi,"'").replace(/&lt;?/gi,'<').replace(/&gt;?/gi,'>')
    .replace(/&[a-z]+;/gi,' ')
    .replace(/\s+/g,' ').trim();
}

function meta(html, claves) {
  const buscadas = new Set((claves || []).map((k) => String(k).toLowerCase()));
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-z_:][-a-z0-9_:]*)\s*=\s*["']([^"']*)["']/gi)) {
      attrs[String(m[1]).toLowerCase()] = m[2];
    }
    const clave = String(attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (buscadas.has(clave) && attrs.content && attrs.content.trim()) return limpiar(attrs.content);
  }
  return null;
}

function fechaJsonLd(html) {
  const bloques = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of bloques) {
    const m = b.match(/"date(?:Published|Created)"\s*:\s*"([^"]+)"/i);
    if (m) return m[1];
  }
  return null;
}

function aIso(s) {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime()) || d.getTime() > Date.now() + 86400000 || d.getFullYear() < 2000) return null;
  return d.toISOString();
}

function cuerpoContexto(html) {
  const bloques = html.match(/<p\b[^>]*>[\s\S]{35,1200}?<\/p>/gi) || [];
  const parrafos = bloques.map(limpiar).filter(t => t.length >= 35);
  if (parrafos.length) return parrafos.join(' ').slice(0, 2400);
  return limpiar(String(html || '').replace(/<(script|style|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, ' ')).slice(0, 2400);
}

return items.map(it => {
  const r = it.json || {};
  const base = { url: r.url, dominio_norm: r.dominio_norm, transporte: r.transporte,
                 http_status: r.http_status ?? null, chars: r.bytes || 0 };

  if ((r.diagnostico !== 'ok' && r.diagnostico !== 'charset_roto') || !r.html) {
    return { json: { ...base, ok: false, diagnostico: r.diagnostico || 'sin_html',
                     titulo: null, copete: null, fecha_pub: null, fecha_origen: null,
                     texto_contexto: null } };
  }

  const html = r.html;
  const titulo = meta(html, ['og:title','twitter:title','headline'])
    || limpiar((html.match(/<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i) || [])[1])
    || limpiar((html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i) || [])[1])
    || null;
  const copete = meta(html, ['og:description','twitter:description','description'])
    || (function () {
         const ps = html.match(/<p[^>]*>([\s\S]{80,600}?)<\/p>/gi) || [];
         for (const p of ps) { const t = limpiar(p); if (t.length >= 80) return t.slice(0, 400); }
         return null;
       })();
  const crudaDeclarada = meta(html, ['article:published_time','og:article:published_time','datePublished','pubdate','date']);
  const crudaJsonLd = fechaJsonLd(html);
  const crudaTime = (html.match(/<time[^>]+datetime\s*=\s*["']([^"']+)/i) || [])[1];
  let fecha = aIso(crudaDeclarada), origen = fecha ? 'meta' : null;
  if (!fecha) { fecha = aIso(crudaJsonLd); if (fecha) origen = 'json_ld'; }
  if (!fecha) { fecha = aIso(crudaTime); if (fecha) origen = 'time'; }
  const okTitulo = !!(titulo && titulo.length >= 15);
  return { json: { ...base,
    ok: okTitulo, diagnostico: okTitulo ? 'ok' : 'sin_titulo',
    titulo: titulo || null, copete: copete || null, fecha_pub: fecha,
    fecha_origen: origen, texto_contexto: cuerpoContexto(html) } };
});`;

const fusionCode = String.raw`// Completa solo la nota correspondiente al item actual.
const r = $json || {};
// En lotes con varias notas, la referencia item puede encontrar más de una coincidencia
// dentro de n8n. La URL es la clave estable de esta rama y evita que A1 entero
// falle con "Multiple matches".
const previas = $('Diagnosticar y limpiar').all().map(x => x.json || {});
const p = previas.find(x => String(x.url || '') === String(r.url || ''))
  || previas[$itemIndex] || previas[0] || {};
const arreglos = [...(p.arreglos || [])];

function palabras(s) {
  return new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length > 4));
}
function copeteCruzado(titulo, copete) {
  const tt = palabras(titulo), ss = palabras(copete);
  if (tt.size < 3 || ss.size < 5) return false;
  let comunes = 0; for (const w of ss) if (tt.has(w)) comunes++;
  return comunes === 0;
}

let titulo = p.titulo, snippet = p.snippet;
let fecha = p.fecha_pub, confiable = p.fecha_confiable, origen = p.fecha_origen;
// Completar cada campo por separado: un sitio puede devolver copete y fecha
// aunque su extractor no haya podido reconocer el titulo.
if (p.falta.titulo && r.titulo && r.titulo.length >= 25) { titulo = r.titulo; arreglos.push('titulo_de_la_pagina'); }
if (p.falta.copete && r.copete && r.copete.length >= 40) {
  if (!copeteCruzado(titulo, r.copete)) { snippet = r.copete; arreglos.push('copete_de_la_pagina'); }
  else arreglos.push('copete_de_la_pagina_descartado_por_cruzado');
}
if (p.falta.fecha && r.fecha_pub) { fecha = r.fecha_pub; confiable = true; origen = r.fecha_origen; arreglos.push('fecha_de_la_pagina'); }
return { json: {
  candidata_id: p.candidata_id, titulo, snippet, fecha_pub: fecha,
  fecha_confiable: confiable, fecha_origen: origen, texto_contexto: r.texto_contexto || null,
  se_abrio: true, arreglos, diagnostico: r.ok ? 'ok' : ('no_abrio:' + (r.diagnostico || '?')),
  sigue_incompleta: !titulo || titulo.length < 25
} };`;

const noOpenCode = String.raw`return items.map(it => {
  const p = it.json || {};
  return { json: {
    candidata_id: p.candidata_id, titulo: p.titulo, snippet: p.snippet,
    fecha_pub: p.fecha_pub, fecha_confiable: p.fecha_confiable, fecha_origen: p.fecha_origen,
    texto_contexto: p.texto_contexto || null, se_abrio: false, arreglos: p.arreglos || [],
    diagnostico: 'ok', sigue_incompleta: false
  } };
});`;

const juntarCode = String.raw`// A1 devuelve una nota por item; el A2 recibe un lote sin duplicados.
const cfg = $('Config').first().json;
const previas = $('Preparar lote').all().map(i => i.json);
const porId = {}; for (const p of previas) porId[p.candidata_id] = p;

function palabrasNota(s) {
  return new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length > 4));
}
function calidadNota(n) {
  const titulo = String(n?.titulo || ''), snippet = String(n?.snippet || ''); let score = 0;
  if (titulo.length >= 25) score += 3; if (snippet.length >= 40) score += 3;
  if (n?.fecha_confiable === true) score += 1; if (n?.diagnostico === 'ok') score += 1;
  const tt = palabrasNota(titulo), ss = palabrasNota(snippet);
  if (tt.size >= 3 && ss.size >= 5) { let comunes = 0; for (const w of ss) if (tt.has(w)) comunes++; score += Math.min(comunes, 4); if (comunes === 0) score -= 10; }
  return score;
}
function guardarLaMejor(map, nota) { if (!nota?.candidata_id) return; const anterior = map.get(nota.candidata_id); if (!anterior || calidadNota(nota) > calidadNota(anterior)) map.set(nota.candidata_id, nota); }

const notasPorId = new Map(); let duplicadasDescartadas = 0;
for (const item of items) {
  const x = item.json || {}; if (!x.candidata_id) continue;
  const p = porId[x.candidata_id] || {};
  const nota = {
    candidata_id: x.candidata_id, titulo: x.titulo, snippet: x.snippet,
    texto_contexto: x.texto_contexto || p.texto_contexto || '', dominio_norm: p.dominio_norm,
    fecha_pub: x.fecha_pub, fecha_confiable: x.fecha_confiable === true, diagnostico: x.diagnostico,
    es_prioritaria: !!p.es_prioritaria, keyword_match: String(p.keyword_match || ''),
    grupo: String(p.grupo || ''), etiqueta: String(p.etiqueta || '')
  };
  if (notasPorId.has(nota.candidata_id)) duplicadasDescartadas++;
  guardarLaMejor(notasPorId, nota);
}
const notas = [...notasPorId.values()];
const TAMANO_LOTE_A2 = 12, totalLotes = Math.max(1, Math.ceil(notas.length / TAMANO_LOTE_A2));
return Array.from({ length: totalLotes }, (_, i) => ({ json: {
  client_id: cfg.client_id, modo: cfg.modo, lote_a2: i + 1, total_lotes_a2: totalLotes,
  notas: notas.slice(i * TAMANO_LOTE_A2, (i + 1) * TAMANO_LOTE_A2), a2_duplicadas_descartadas: duplicadasDescartadas
} }));`;

const a2PrepareCode = String.raw`const req = $('Entrada').first().json;
const notas = Array.isArray(req.notas) ? req.notas : [];
const filas = items.map(i => i.json).filter(x => x && x.nombre);
const secciones = filas.map(x => x.nombre);
if (!secciones.length || !notas.length) return [{ json: { abortar: true, motivo: !notas.length ? 'lote vacio' : 'el cliente no tiene secciones activas', client_id: req.client_id, run_id: req.run_id || null, modo: req.modo || 'test', notas } }];

const articulos = notas.map((n, i) => ({
  id: i + 1, title: String(n.titulo || '').slice(0, 300), snippet: String(n.snippet || '').slice(0, 300),
  body_context: String(n.texto_contexto || '').slice(0, 1800), medio: n.dominio_norm || 'desconocido',
  pubDate: n.fecha_pub ? String(n.fecha_pub).slice(0, 10) : '', keyword_match: String(n.keyword_match || ''),
  grupo: String(n.grupo || ''), etiqueta: String(n.etiqueta || (n.es_prioritaria ? 'PRIORITARIA' : ''))
}));
const user = 'SECCIONES (usá exactamente uno de estos nombres):\\n' + secciones.map(s => '- ' + s).join('\\n')
  + '\\n\\nREGLA DE SECCION: si grupo no está vacío, es la guía heredada de la v3. Usá la sección activa equivalente; no inventes una categoría nueva.\\n'
  + '\\nNOTAS a evaluar (' + articulos.length + '):\\n\\n' + JSON.stringify(articulos)
  + '\\n\\nPAIS: además del dominio, revisá body_context. Si la nota está centrada en otro país y no tiene ángulo argentino, no la conserves.\\n'
  + '\\nDevolvé un veredicto por CADA id, en el formato de la ADENDA v2.';
return [{ json: { abortar: false, client_id: req.client_id, run_id: req.run_id || null, modo: req.modo || 'test', stage: 'a2', json: true, secciones, notas, user } }];`;

const a2ApplyCode = String.raw`// Traduce la salida del modelo y aplica las restricciones duras en código.
const p = $('Armar el pedido').first().json;
const r = (items[0] && items[0].json) || {};
const notas = p.notas || [], validas = new Set(p.secciones || []);
const porDefecto = (p.secciones || [])[0] || null;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const porNorm = new Map((p.secciones || []).map(s => [norm(s), s]));
function seccionPorGrupo(grupo) {
  const g = norm(grupo); if (!g) return null;
  if (porNorm.has(g)) return porNorm.get(g);
  const aliases = {
    'productos bms': ['notas exclusivas', 'productos bms', 'exclusivas'],
    'exclusivas': ['notas exclusivas', 'exclusiva', 'exclusivas'],
    'industria y competencia': ['competencia', 'industria y competencia'],
    'regulatorio y gobierno': ['noticias del sector', 'regulatorio y gobierno'],
    'sector y gestion': ['noticias del sector', 'sector y gestion'],
    'indicaciones y areas terapeuticas': ['areas terapeuticas', 'indicaciones y areas terapeuticas', 'noticias del sector'],
    'noticias de interes': ['noticias de interes'],
    'ganaderia': ['ganaderia']
  };
  return (aliases[g] || []).map(x => porNorm.get(x)).find(Boolean) || null;
}
function sinAcentos(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
const extranjeros = [
  /\bespana\b|\bmadrid\b|\bbarcelona\b|\bvalencia\b|\bsevilla\b/,
  /\breino\s+unido\b|\binglaterra\b|\blondres\b|\bescocia\b|\bgales\b/,
  /\bbrasil\b|\bbrazil\b|\bribeirao\s+preto\b|\bsao\s+paulo\b/,
  /\bmexico\b|\bciudad\s+de\s+mexico\b|\bchile\b|\bcolombia\b|\bperu\b|\buruguay\b|\bparaguay\b|\bbolivia\b/,
  /\bfrancia\b|\bparis\b|\balemania\b|\bitalia\b|\bportugal\b|\bchina\b|\bjapon\b|\bindia\b|\bestados\s+unidos\b|\bee\.?uu\.?\b/,
  /\bsuecia\b|\bestocolmo\b|\bcanada\b|\baustralia\b|\brusia\b|\bucrania\b|\bisrael\b|\bturquia\b|\bsuiza\b|\bbelgica\b|\baustria\b|\bcorea\b|\bsudafrica\b|\bpaises\s+bajos\b/
];
const argentinos = /\bargentin(?:a|o|as|os)\b|\bbuenos\s+aires\b|\bcaba\b/;
function esNotaExtranjera(n) {
  const titulo = sinAcentos(n.titulo), snippet = sinAcentos(n.snippet), cuerpo = sinAcentos(n.texto_contexto);
  const encabezado = titulo + ' ' + snippet + ' ' + cuerpo.slice(0, 900);
  const mencionaExtranjero = extranjeros.some(re => re.test(encabezado));
  const menciones = extranjeros.reduce((total, re) => total + (re.test(titulo + ' ' + snippet + ' ' + cuerpo) ? 1 : 0), 0);
  return mencionaExtranjero && !argentinos.test(encabezado) && (foreignIn(titulo) || foreignIn(cuerpo.slice(0, 900)) || menciones >= 2);
}
function foreignIn(s) { return extranjeros.some(re => re.test(s)); }

let dict = {}, diagLote = r.diagnostico || 'error_modelo';
if (r.ok && r.contenido) {
  try { const j = JSON.parse(r.contenido); for (const v of (Array.isArray(j.notas) ? j.notas : [])) if (v && Number.isFinite(v.id)) dict[v.id] = v; diagLote = 'ok'; }
  catch (e) { diagLote = 'respuesta_invalida'; }
}
return notas.map((n, i) => {
  const v = dict[i + 1]; let entra = v ? !!v.entra : null;
  let seccion = v && v.seccion ? String(v.seccion) : null;
  let confianza = v && Number.isFinite(v.confianza) ? Number(v.confianza) : null;
  let forzada = false, motivo = null;
  if (seccion && !validas.has(seccion)) { motivo = 'seccion inventada: "' + seccion + '"'; seccion = porDefecto; forzada = true; }
  const guiada = seccionPorGrupo(n.grupo);
  if (guiada && seccion !== guiada) { seccion = guiada; forzada = true; motivo = (motivo ? motivo + '; ' : '') + 'seccion alineada con grupo v3'; }
  if (n.es_prioritaria && entra === false) { entra = true; forzada = true; motivo = (motivo ? motivo + '; ' : '') + 'prioritaria: el A2 no puede descartarla'; }
  if (esNotaExtranjera(n)) { entra = false; forzada = true; motivo = (motivo ? motivo + '; ' : '') + 'nota centrada en otro pais según cuerpo de la nota'; }
  const diag = v ? diagLote : (diagLote === 'ok' ? 'sin_veredicto' : diagLote);
  if (!v && n.es_prioritaria && !esNotaExtranjera(n)) { entra = true; forzada = true; motivo = 'prioritaria sin veredicto: entra por defecto'; }
  if (entra && !seccion) { seccion = porDefecto; forzada = true; motivo = (motivo ? motivo + '; ' : '') + 'entra sin seccion asignada'; }
  return { json: { candidata_id: n.candidata_id, titulo: n.titulo, snippet: n.snippet, entra, seccion, confianza, forzada, motivo_forzada: motivo, diagnostico: diag, es_prioritaria: !!n.es_prioritaria, tokens: r.tokens ?? 0, costo_usd: r.costo_usd ?? null } };
});`;

async function updateWorkflow(id, changes, parameterChanges = {}) {
  const workflow = await request(`/api/v1/workflows/${id}`);
  const active = workflow.activeVersion || workflow;
  const nodes = active.nodes || [];
  for (const [name, code] of Object.entries(changes)) {
    const node = nodes.find(n => n.name === name);
    if (!node) throw new Error(`No existe el nodo ${name} en ${id}.`);
    node.parameters = node.parameters || {};
    node.parameters.jsCode = code;
  }
  for (const [name, patch] of Object.entries(parameterChanges)) {
    const node = nodes.find(n => n.name === name);
    if (!node) throw new Error(`No existe el nodo ${name} en ${id}.`);
    node.parameters = { ...(node.parameters || {}), ...patch };
  }
  await request(`/api/v1/workflows/${id}`, { method: 'PUT', body: JSON.stringify({
    name: workflow.name, nodes, connections: active.connections || workflow.connections || {},
    settings: active.settings || workflow.settings || {}, staticData: active.staticData,
    pinData: active.pinData, meta: active.meta,
  }) });
  const published = await request(`/api/v1/workflows/${id}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${id}`);
  const v = verified.activeVersion || verified;
  for (const name of Object.keys(changes)) {
    const node = (v.nodes || []).find(n => n.name === name);
    if (!String(node?.parameters?.jsCode || '').includes('texto_contexto') && !String(node?.parameters?.jsCode || '').includes('seccionPorGrupo')) {
      throw new Error(`No quedó verificado el cambio en ${id}/${name}.`);
    }
  }
  return { id, name: workflow.name, activeVersionId: verified.activeVersionId || null, publishedVersionId: published?.id || published?.versionId || null, nodes: Object.keys(changes) };
}

(async () => {
  const results = [];
  results.push(await updateWorkflow('mnofS4TurFRTVRsh', { 'Extraer la nota': extractCode }));
  results.push(await updateWorkflow('E5JLokzkBxeCyLzv',
    { 'Fusionar lo que trajo': fusionCode, 'No hizo falta abrir': noOpenCode },
    { 'open-article': { mode: 'each' } }));
  results.push(await updateWorkflow('ORrmePsGxJJxISTo', { 'Juntar el lote para el A2': juntarCode }));
  results.push(await updateWorkflow('9pwrSH2KdpGhbXjS', { 'Armar el pedido': a2PrepareCode, 'Aplicar el veredicto': a2ApplyCode }));
  console.log(JSON.stringify({ ok: true, changes: results, databaseMigration: '20260914110000_v4_archivos_y_reglas_pais.sql', safeguards: ['contexto de cuerpo acotado a 2400 caracteres', 'pais revisado antes de guardar el veredicto', 'grupo de keyword alineado a seccion activa', 'URLs de archivo/listado bloqueadas por regla'] }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
