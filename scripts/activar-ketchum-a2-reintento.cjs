const fs = require('fs');
const crypto = require('crypto');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'ORrmePsGxJJxISTo';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${body.slice(0, 1200)}`);
  return body ? JSON.parse(body) : {};
}

const firstPassCode = String.raw`const cfg = $('Config').first().json || {};

const esperadas = new Map();
for (const item of $('Preparar lote').all()) {
  const nota = item.json || {};
  if (nota.candidata_id) esperadas.set(nota.candidata_id, nota);
}

// A1 es quien completa el copete/titulo/fecha. Guardar esa version junto al
// veredicto evita que el email vuelva al snippet crudo del feed.
const enriquecidas = new Map();
for (const item of $('A1 completador').all()) {
  const nota = item.json || {};
  if (nota.candidata_id) enriquecidas.set(nota.candidata_id, nota);
}

const filasPorId = new Map();
let repetidas = 0;
for (const it of items) {
  const x = it.json || {};
  if (!x.candidata_id || !esperadas.has(x.candidata_id)) continue;
  if (filasPorId.has(x.candidata_id)) { repetidas++; continue; }

  const enriquecida = enriquecidas.get(x.candidata_id) || esperadas.get(x.candidata_id) || {};
  const f = {
    client_id: cfg.client_id,
    candidata_id: x.candidata_id,
    titulo: enriquecida.titulo || null,
    snippet: enriquecida.snippet || null,
    fecha_pub: enriquecida.fecha_pub || null,
    fecha_confiable: enriquecida.fecha_confiable === true,
    entra: x.entra === true,
    seccion: x.seccion || null,
    confianza: (x.confianza === null || x.confianza === undefined) ? null : Number(x.confianza),
    forzada: !!x.forzada,
    motivo_forzada: x.motivo_forzada || null,
    agente: 'a2',
    modo: cfg.modo
  };
  if (cfg.fecha) f.fecha = cfg.fecha;
  filasPorId.set(x.candidata_id, f);
}

// No convertimos un A2 incompleto en un falso negativo. Lo devolvemos como
// lote chico para un segundo llamado al juez.
const incompletasNotas = [];
for (const candidataId of esperadas.keys()) {
  if (filasPorId.has(candidataId)) continue;
  const p = esperadas.get(candidataId) || {};
  const enriquecida = enriquecidas.get(candidataId) || p;
  incompletasNotas.push({
    candidata_id: candidataId,
    titulo: enriquecida.titulo,
    snippet: enriquecida.snippet,
    dominio_norm: p.dominio_norm,
    fecha_pub: enriquecida.fecha_pub || p.fecha_pub,
    es_prioritaria: !!p.es_prioritaria,
    keyword_match: String(p.keyword_match || ''),
    grupo: String(p.grupo || ''),
    etiqueta: String(p.etiqueta || '')
  });
}

const filas = [...filasPorId.values()];
if (repetidas || incompletasNotas.length) {
  console.log('[armado] A2 repetidas=' + repetidas + ' incompletas=' + incompletasNotas.length);
}
return [{ json: {
  client_id: cfg.client_id,
  fecha: cfg.fecha || null,
  modo: cfg.modo,
  filas,
  cuantas: filas.length,
  repetidas,
  incompletas: incompletasNotas.length,
  incompletas_notas: incompletasNotas
} }];`;

const retryPrepCode = String.raw`const base = $('Armar veredictos').first().json || {};
const notas = Array.isArray(base.incompletas_notas) ? base.incompletas_notas : [];
const cfg = $('Config').first().json || {};
const TAMANO_REINTENTO = 8;
const total = Math.max(1, Math.ceil(notas.length / TAMANO_REINTENTO));

return Array.from({ length: total }, (_, i) => ({ json: {
  client_id: cfg.client_id,
  modo: cfg.modo,
  reintento_a2: true,
  lote_a2: i + 1,
  total_lotes_a2: total,
  notas: notas.slice(i * TAMANO_REINTENTO, (i + 1) * TAMANO_REINTENTO)
} }));`;

const finalCode = String.raw`const cfg = $('Config').first().json || {};
const primera = $('Armar veredictos').first().json || {};
const incompletasIniciales = new Map(
  (Array.isArray(primera.incompletas_notas) ? primera.incompletas_notas : [])
    .filter(n => n && n.candidata_id)
    .map(n => [n.candidata_id, n])
);

const enriquecidas = new Map();
for (const item of $('A1 completador').all()) {
  const nota = item.json || {};
  if (nota.candidata_id) enriquecidas.set(nota.candidata_id, nota);
}

const filasPorId = new Map(
  (Array.isArray(primera.filas) ? primera.filas : [])
    .filter(f => f && f.candidata_id)
    .map(f => [f.candidata_id, f])
);
let repetidas = Number(primera.repetidas || 0);

let reintentos = [];
try { reintentos = $('A2 juez - reintento').all().map(i => i.json || {}); } catch (e) {}
for (const x of reintentos) {
  if (!x.candidata_id || !incompletasIniciales.has(x.candidata_id)) continue;
  if (filasPorId.has(x.candidata_id)) { repetidas++; continue; }
  const p = incompletasIniciales.get(x.candidata_id) || {};
  const enriquecida = enriquecidas.get(x.candidata_id) || p;
  const f = {
    client_id: cfg.client_id,
    candidata_id: x.candidata_id,
    titulo: enriquecida.titulo || null,
    snippet: enriquecida.snippet || null,
    fecha_pub: enriquecida.fecha_pub || null,
    fecha_confiable: enriquecida.fecha_confiable === true,
    entra: x.entra === true,
    seccion: x.seccion || null,
    confianza: (x.confianza === null || x.confianza === undefined) ? null : Number(x.confianza),
    forzada: !!x.forzada,
    motivo_forzada: x.motivo_forzada || null,
    agente: 'a2_reintento',
    modo: cfg.modo
  };
  if (cfg.fecha) f.fecha = cfg.fecha;
  filasPorId.set(x.candidata_id, f);
}

const faltantesFinales = [];
for (const [candidataId, p] of incompletasIniciales) {
  if (filasPorId.has(candidataId)) continue;
  const enriquecida = enriquecidas.get(candidataId) || p;
  const prioritaria = !!p.es_prioritaria;
  faltantesFinales.push({
    client_id: cfg.client_id,
    candidata_id: candidataId,
    titulo: enriquecida.titulo || null,
    snippet: enriquecida.snippet || null,
    fecha_pub: enriquecida.fecha_pub || null,
    fecha_confiable: enriquecida.fecha_confiable === true,
    entra: prioritaria,
    seccion: null,
    confianza: null,
    forzada: prioritaria,
    motivo_forzada: prioritaria ? 'A2 incompleto luego del reintento; prioridad preservada' : null,
    agente: 'a2_incompleto',
    modo: cfg.modo
  });
}

const filas = [...filasPorId.values(), ...faltantesFinales];
if (faltantesFinales.length) {
  console.log('[armado] A2 sigue incompleto luego del reintento=' + faltantesFinales.length);
}
return [{ json: {
  client_id: cfg.client_id,
  fecha: cfg.fecha || null,
  modo: cfg.modo,
  filas,
  cuantas: filas.length,
  repetidas,
  incompletas: faltantesFinales.length
} }];`;

const closureCode = String.raw`const claim = $('Tomar pagina').first().json || {};
let veredictos = {};
try { veredictos = $('Armar veredictos finales').first().json || {}; }
catch (e) { try { veredictos = $('Armar veredictos').first().json || {}; } catch (ignored) {} }
const candidatas = Number(claim.candidatas || 0);
const juzgadas = Number(veredictos.cuantas || 0);
const incompletas = Number(veredictos.incompletas || 0);
const estado = candidatas > 0 && juzgadas >= candidatas && incompletas === 0 ? 'ok' : 'error';
return [{ json: {
  run_id: claim.run_id,
  pagina: Number(claim.pagina),
  candidatas,
  juzgadas,
  estado,
  detalle: {
    candidatas,
    juzgadas,
    repetidas: Number(veredictos.repetidas || 0),
    incompletas_a2: incompletas
  }
} }];`;

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const nodes = active.nodes || [];
  const byName = (name) => nodes.find((n) => n.name === name);
  const required = ['A2 juez', 'Armar veredictos', '¿hay veredictos?', 'Preparar cierre de pagina'];
  for (const name of required) if (!byName(name)) throw new Error(`No existe el nodo ${name}.`);

  if (byName('¿hay incompletas A2?') || byName('Preparar reintento A2') || byName('A2 juez - reintento') || byName('Armar veredictos finales')) {
    throw new Error('Ya existe parte del reintento; no publico una topologia parcial.');
  }

  const armar = byName('Armar veredictos');
  const originalArmar = String(armar.parameters?.jsCode || '');
  if (!originalArmar.includes('const esperadas = new Map();') || !originalArmar.includes('const enriquecidas = new Map();')) {
    throw new Error('Armar veredictos cambio; no se reemplaza a ciegas.');
  }
  armar.parameters.jsCode = firstPassCode;

  const cierre = byName('Preparar cierre de pagina');
  const originalCierre = String(cierre.parameters?.jsCode || '');
  if (!originalCierre.includes("const candidatas = Number(claim.candidatas || 0);")) {
    throw new Error('Preparar cierre de pagina cambio; no se reemplaza a ciegas.');
  }
  cierre.parameters.jsCode = closureCode;

  const a2 = byName('A2 juez');
  const now = Date.now();
  const retryIf = {
    ...byName('¿hay veredictos?'),
    id: crypto.randomUUID(),
    name: '¿hay incompletas A2?',
    position: [1000, 760],
    parameters: JSON.parse(JSON.stringify(byName('¿hay veredictos?').parameters)),
  };
  retryIf.parameters.conditions.conditions = [{
    id: `a2-incomplete-${now}`,
    leftValue: '={{ $json.incompletas }}',
    rightValue: 0,
    operator: { type: 'number', operation: 'gt' },
  }];

  const retryA2 = {
    ...a2,
    id: crypto.randomUUID(),
    name: 'A2 juez - reintento',
    position: [1420, 900],
    parameters: JSON.parse(JSON.stringify(a2.parameters)),
  };
  const prepRetry = {
    id: crypto.randomUUID(),
    name: 'Preparar reintento A2',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1210, 900],
    parameters: { mode: 'runOnceForAllItems', jsCode: retryPrepCode },
  };
  const final = {
    id: crypto.randomUUID(),
    name: 'Armar veredictos finales',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1700, 760],
    parameters: { mode: 'runOnceForAllItems', jsCode: finalCode },
  };
  nodes.push(retryIf, prepRetry, retryA2, final);

  const connections = active.connections || {};
  connections['Armar veredictos'] = { main: [[{ node: retryIf.name, type: 'main', index: 0 }]] };
  connections[retryIf.name] = { main: [
    [{ node: prepRetry.name, type: 'main', index: 0 }],
    [{ node: final.name, type: 'main', index: 0 }],
  ] };
  connections[prepRetry.name] = { main: [[{ node: retryA2.name, type: 'main', index: 0 }]] };
  connections[retryA2.name] = { main: [[{ node: final.name, type: 'main', index: 0 }]] };
  connections[final.name] = { main: [[{ node: '¿hay veredictos?', type: 'main', index: 0 }]] };

  const payload = {
    name: workflow.name,
    nodes,
    connections,
    settings: active.settings || workflow.settings || {},
    staticData: active.staticData,
    pinData: active.pinData,
    meta: active.meta,
  };
  await request(`/api/v1/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify(payload) });
  const published = await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });

  const verifiedWorkflow = await request(`/api/v1/workflows/${workflowId}`);
  const verified = verifiedWorkflow.activeVersion || verifiedWorkflow;
  const names = (verified.nodes || []).map(n => n.name);
  const verifiedArmar = (verified.nodes || []).find(n => n.name === 'Armar veredictos');
  const verifiedFinal = (verified.nodes || []).find(n => n.name === 'Armar veredictos finales');
  const verifiedClosure = (verified.nodes || []).find(n => n.name === 'Preparar cierre de pagina');
  if (!names.includes('¿hay incompletas A2?') || !names.includes('A2 juez - reintento') || !names.includes('Armar veredictos finales')) {
    throw new Error('La versión publicada no contiene todos los nodos de reintento.');
  }
  if (!String(verifiedArmar?.parameters?.jsCode || '').includes('incompletas_notas')) throw new Error('No quedó el primer armado con incompletas identificadas.');
  if (!String(verifiedFinal?.parameters?.jsCode || '').includes('a2_reintento')) throw new Error('No quedó el armado final del reintento.');
  if (!String(verifiedClosure?.parameters?.jsCode || '').includes('incompletas === 0')) throw new Error('No quedó el cierre estricto de página.');

  console.log(JSON.stringify({
    ok: true,
    workflowId,
    activeVersionId: verifiedWorkflow.activeVersionId || null,
    publishedVersionId: published?.id || published?.versionId || null,
    retryBatchSize: 8,
    nodes: ['¿hay incompletas A2?', 'Preparar reintento A2', 'A2 juez - reintento', 'Armar veredictos finales'],
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });

