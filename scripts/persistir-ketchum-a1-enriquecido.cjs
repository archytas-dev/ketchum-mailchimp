const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'ORrmePsGxJJxISTo';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : null;
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const node = (active.nodes || []).find((n) => n.name === 'Armar veredictos');
  if (!node) throw new Error('No existe el nodo Armar veredictos.');

  const original = String(node.parameters?.jsCode || '');
  if (!original.includes("const vistos = new Map();")) throw new Error('El codigo de Armar veredictos cambio; no se aplica un parche inseguro.');

  let code = original;
  code = code.replace(
    "const vistos = new Map();\nlet repetidas = 0;",
    "// A1 es quien completa el copete/titulo/fecha. Guardar esa version junto al\n// veredicto evita que el email vuelva al snippet crudo del feed.\nconst enriquecidas = new Map();\nfor (const item of $('A1 completador').all()) {\n  const nota = item.json || {};\n  if (nota.candidata_id) enriquecidas.set(nota.candidata_id, nota);\n}\n\nconst vistos = new Map();\nlet repetidas = 0;"
  );
  code = code.replace(
    "const f = {\n    client_id: cfg.client_id,\n    candidata_id: x.candidata_id,",
    "const enriquecida = enriquecidas.get(x.candidata_id) || esperadas.get(x.candidata_id) || {};\n  const f = {\n    client_id: cfg.client_id,\n    candidata_id: x.candidata_id,\n    titulo: enriquecida.titulo || null,\n    snippet: enriquecida.snippet || null,\n    fecha_pub: enriquecida.fecha_pub || null,\n    fecha_confiable: enriquecida.fecha_confiable === true,"
  );
  code = code.replace(
    "const f = {\n    client_id: cfg.client_id,\n    candidata_id: candidataId,",
    "const enriquecida = enriquecidas.get(candidataId) || esperadas.get(candidataId) || {};\n  const f = {\n    client_id: cfg.client_id,\n    candidata_id: candidataId,\n    titulo: enriquecida.titulo || null,\n    snippet: enriquecida.snippet || null,\n    fecha_pub: enriquecida.fecha_pub || null,\n    fecha_confiable: enriquecida.fecha_confiable === true,"
  );
  if (code === original) throw new Error('No se pudo aplicar el parche de enriquecimiento.');
  node.parameters.jsCode = code;

  const body = {
    name: workflow.name,
    nodes: active.nodes,
    connections: active.connections,
    settings: active.settings || workflow.settings || {},
    staticData: active.staticData,
    pinData: active.pinData,
    meta: active.meta,
  };
  const updated = await request(`/api/v1/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify(body) });
  const published = await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: JSON.stringify({}) });
  console.log(JSON.stringify({
    workflowId,
    updatedVersion: updated?.activeVersionId || updated?.versionId || null,
    publishedVersion: published?.id || published?.versionId || null,
    hasEnrichedSnapshot: /const enriquecidas = new Map/.test(code),
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
