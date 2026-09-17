const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');

const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${body.slice(0, 1200)}`);
  return body ? JSON.parse(body) : {};
}

function activeNodes(workflow) {
  const active = workflow.activeVersion || workflow;
  if (!Array.isArray(active.nodes)) throw new Error(`Workflow sin nodos: ${workflow.id}`);
  return { active, nodes: active.nodes };
}

function node(nodes, name) {
  const found = nodes.find((item) => item.name === name);
  if (!found) throw new Error(`No encontre el nodo ${name}.`);
  return found;
}

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`No encontre el bloque esperado en ${label}.`);
  return source.replace(before, after);
}

const a1FusionCode = String.raw`// Completa solo la nota que corresponde al item actual.
// Si el extractor devuelve un copete de otra nota, se descarta y no se propaga.
const r = $json || {};
const p = $('Diagnosticar y limpiar').item.json;
const arreglos = [...(p.arreglos || [])];

function palabras(s) {
  return new Set(String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length > 4));
}

function copeteCruzado(titulo, copete) {
  const tt = palabras(titulo);
  const ss = palabras(copete);
  if (tt.size < 3 || ss.size < 5) return false;
  let comunes = 0;
  for (const w of ss) if (tt.has(w)) comunes++;
  return comunes === 0;
}

let titulo = p.titulo, snippet = p.snippet;
let fecha = p.fecha_pub, confiable = p.fecha_confiable, origen = p.fecha_origen;

if (r.ok) {
  if (p.falta.titulo && r.titulo && r.titulo.length >= 25) {
    titulo = r.titulo;
    arreglos.push('titulo_de_la_pagina');
  }
  if (p.falta.copete && r.copete && r.copete.length >= 40) {
    if (!copeteCruzado(titulo, r.copete)) {
      snippet = r.copete;
      arreglos.push('copete_de_la_pagina');
    } else {
      arreglos.push('copete_de_la_pagina_descartado_por_cruzado');
    }
  }
  if (p.falta.fecha && r.fecha_pub) {
    fecha = r.fecha_pub;
    confiable = true;
    origen = r.fecha_origen;
    arreglos.push('fecha_de_la_pagina');
  }
}

return { json: {
  candidata_id: p.candidata_id,
  titulo,
  snippet,
  fecha_pub: fecha,
  fecha_confiable: confiable,
  fecha_origen: origen,
  se_abrio: true,
  arreglos,
  diagnostico: r.ok ? 'ok' : ('no_abrio:' + (r.diagnostico || '?')),
  sigue_incompleta: !titulo || titulo.length < 25
} };`;

const qualityBlock = String.raw`function palabrasNota(s) {
  return new Set(String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length > 4));
}

function calidadNota(n) {
  const titulo = String(n?.titulo || '');
  const snippet = String(n?.snippet || '');
  let score = 0;
  if (titulo.length >= 25) score += 3;
  if (snippet.length >= 40) score += 3;
  if (n?.fecha_confiable === true) score += 1;
  if (n?.diagnostico === 'ok') score += 1;
  const tt = palabrasNota(titulo);
  const ss = palabrasNota(snippet);
  if (tt.size >= 3 && ss.size >= 5) {
    let comunes = 0;
    for (const w of ss) if (tt.has(w)) comunes++;
    score += Math.min(comunes, 4);
    if (comunes === 0) score -= 10;
  }
  return score;
}

function guardarLaMejor(map, nota) {
  if (!nota?.candidata_id) return;
  const anterior = map.get(nota.candidata_id);
  if (!anterior || calidadNota(nota) > calidadNota(anterior)) map.set(nota.candidata_id, nota);
}`;

const mainJuntarCode = String.raw`// A1 devuelve una nota por item; el A2 recibe un lote sin duplicados.
const cfg = $('Config').first().json;
const previas = $('Preparar lote').all().map(i => i.json);
const porId = {}; for (const p of previas) porId[p.candidata_id] = p;

${qualityBlock}

const notasPorId = new Map();
let duplicadasDescartadas = 0;
for (const item of items) {
  const x = item.json || {};
  if (!x.candidata_id) continue;
  const p = porId[x.candidata_id] || {};
  const nota = {
    candidata_id: x.candidata_id,
    titulo: x.titulo,
    snippet: x.snippet,
    dominio_norm: p.dominio_norm,
    fecha_pub: x.fecha_pub,
    fecha_confiable: x.fecha_confiable === true,
    diagnostico: x.diagnostico,
    es_prioritaria: !!p.es_prioritaria,
    keyword_match: String(p.keyword_match || ''),
    grupo: String(p.grupo || ''),
    etiqueta: String(p.etiqueta || '')
  };
  if (notasPorId.has(nota.candidata_id)) duplicadasDescartadas++;
  guardarLaMejor(notasPorId, nota);
}
const notas = [...notasPorId.values()];
const TAMANO_LOTE_A2 = 12;
const totalLotes = Math.max(1, Math.ceil(notas.length / TAMANO_LOTE_A2));
return Array.from({ length: totalLotes }, (_, i) => ({ json: {
  client_id: cfg.client_id,
  modo: cfg.modo,
  lote_a2: i + 1,
  total_lotes_a2: totalLotes,
  notas: notas.slice(i * TAMANO_LOTE_A2, (i + 1) * TAMANO_LOTE_A2),
  a2_duplicadas_descartadas: duplicadasDescartadas
} }));`;

function patchEnrichedMap(code, label) {
  const before = `const enriquecidas = new Map();\nfor (const item of $('A1 completador').all()) {\n  const nota = item.json || {};\n  if (nota.candidata_id) enriquecidas.set(nota.candidata_id, nota);\n}`;
  const after = `const enriquecidas = new Map();\n${qualityBlock}\nfor (const item of $('A1 completador').all()) guardarLaMejor(enriquecidas, item.json || {});`;
  return replaceExact(code, before, after, label);
}

const mainId = 'ORrmePsGxJJxISTo';
const a1Id = 'E5JLokzkBxeCyLzv';

(async () => {
  const a1 = await request(`/api/v1/workflows/${a1Id}`);
  const a1Info = activeNodes(a1);
  const a1Node = node(a1Info.nodes, 'Fusionar lo que trajo');
  a1Node.parameters.jsCode = a1FusionCode;
  const a1Body = { name: a1.name, nodes: a1Info.nodes, connections: a1Info.active.connections, settings: a1Info.active.settings || a1.settings || {} };
  await request(`/api/v1/workflows/${a1Id}`, { method: 'PUT', body: JSON.stringify(a1Body) });
  await request(`/api/v1/workflows/${a1Id}/publish`, { method: 'POST', body: '{}' });

  const main = await request(`/api/v1/workflows/${mainId}`);
  const mainInfo = activeNodes(main);
  const juntar = node(mainInfo.nodes, 'Juntar el lote para el A2');
  juntar.parameters.jsCode = mainJuntarCode;

  for (const name of ['Armar veredictos', 'Armar veredictos finales']) {
    const n = node(mainInfo.nodes, name);
    n.parameters.jsCode = patchEnrichedMap(String(n.parameters.jsCode || ''), name);
  }

  const materializar = node(mainInfo.nodes, 'Materializar pool');
  const bodyBefore = String(materializar.parameters.jsonBody || '');
  const bodyAfter = `={{ JSON.stringify({\n  p_run_id: $('Abrir corrida del día').first().json.run_id,\n  // Un test siempre recorre todo el universo; el limite queda solo para prod.\n  p_tope: $('Config').first().json.modo === 'test' ? null : $('Config').first().json.limite\n}) }}`;
  if (!bodyBefore.includes('p_tope:')) throw new Error('Materializar pool no tiene p_tope; no se reemplaza a ciegas.');
  materializar.parameters.jsonBody = bodyAfter;

  const tomar = node(mainInfo.nodes, 'Tomar pagina');
  const leer = node(mainInfo.nodes, 'Leer lote');
  tomar.parameters.jsonBody = String(tomar.parameters.jsonBody || '').replace(/p_limite:\s*\d+/, 'p_limite: 10');
  leer.parameters.jsonBody = String(leer.parameters.jsonBody || '').replace(/p_limite:\s*\d+/, 'p_limite: 10');

  const mainBody = { name: main.name, nodes: mainInfo.nodes, connections: mainInfo.active.connections, settings: mainInfo.active.settings || main.settings || {} };
  await request(`/api/v1/workflows/${mainId}`, { method: 'PUT', body: JSON.stringify(mainBody) });
  await request(`/api/v1/workflows/${mainId}/publish`, { method: 'POST', body: '{}' });

  const [a1Verified, mainVerified] = await Promise.all([
    request(`/api/v1/workflows/${a1Id}`),
    request(`/api/v1/workflows/${mainId}`),
  ]);
  const a1Active = activeNodes(a1Verified).nodes;
  const mainActive = activeNodes(mainVerified).nodes;
  const checks = {
    a1RejectsCrossedCopete: /copete_de_la_pagina_descartado_por_cruzado/.test(node(a1Active, 'Fusionar lo que trajo').parameters.jsCode || ''),
    a2KeepsBestDuplicate: /calidadNota/.test(node(mainActive, 'Juntar el lote para el A2').parameters.jsCode || ''),
    verdictKeepsBestEnrichment: /guardarLaMejor\(enriquecidas/.test(node(mainActive, 'Armar veredictos').parameters.jsCode || ''),
    finalVerdictKeepsBestEnrichment: /guardarLaMejor\(enriquecidas/.test(node(mainActive, 'Armar veredictos finales').parameters.jsCode || ''),
    testPoolHasNoCap: /modo === 'test' \? null/.test(node(mainActive, 'Materializar pool').parameters.jsonBody || ''),
    pageSizeTen: /p_limite: 10/.test(node(mainActive, 'Tomar pagina').parameters.jsonBody || '') && /p_limite: 10/.test(node(mainActive, 'Leer lote').parameters.jsonBody || ''),
    a1Version: a1Verified.activeVersionId,
    mainVersion: mainVerified.activeVersionId,
  };
  if (Object.entries(checks).some(([key, value]) => ['a1RejectsCrossedCopete', 'a2KeepsBestDuplicate', 'verdictKeepsBestEnrichment', 'finalVerdictKeepsBestEnrichment', 'testPoolHasNoCap', 'pageSizeTen'].includes(key) && !value)) {
    throw new Error(`Verificacion incompleta: ${JSON.stringify(checks)}`);
  }
  console.log(JSON.stringify({ ok: true, scope: ['A1 copetes', 'deduplicacion A1/A2', 'test completo aislado'], checks }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
