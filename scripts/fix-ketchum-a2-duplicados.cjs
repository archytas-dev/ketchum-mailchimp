const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'ORrmePsGxJJxISTo';
const nodeName = 'Juntar el lote para el A2';

async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const node = workflow.nodes.find((item) => item.name === nodeName);
  if (!node) throw new Error(`No encontre el nodo ${nodeName}.`);

  const before = String(node.parameters?.jsCode || '');
  const oldBlock = `const notas = items.map(i => i.json).filter(x => x && x.candidata_id).map(x => {
  const p = porId[x.candidata_id] || {};
  return {
    candidata_id: x.candidata_id,
    titulo: x.titulo, snippet: x.snippet,
    dominio_norm: p.dominio_norm, fecha_pub: x.fecha_pub,
    es_prioritaria: !!p.es_prioritaria,
    keyword_match: String(p.keyword_match || ''), grupo: String(p.grupo || ''), etiqueta: String(p.etiqueta || '')
  };
});`;
  const newBlock = `// A1 puede devolver el mismo candidata_id mas de una vez. A2 necesita una sola
// entrada por candidata: si no, una repetida desplaza a otra y queda a2_incompleto.
const notasPorId = new Map();
let duplicadasDescartadas = 0;
for (const item of items) {
  const x = item.json;
  if (!x || !x.candidata_id) continue;
  const p = porId[x.candidata_id] || {};
  const nota = {
    candidata_id: x.candidata_id,
    titulo: x.titulo, snippet: x.snippet,
    dominio_norm: p.dominio_norm, fecha_pub: x.fecha_pub,
    es_prioritaria: !!p.es_prioritaria,
    keyword_match: String(p.keyword_match || ''), grupo: String(p.grupo || ''), etiqueta: String(p.etiqueta || '')
  };
  const anterior = notasPorId.get(nota.candidata_id);
  if (anterior) {
    duplicadasDescartadas++;
    // Conserva la version con mas texto disponible para que A2 juzgue mejor.
    if (String(nota.snippet || '').length > String(anterior.snippet || '').length) notasPorId.set(nota.candidata_id, nota);
  } else {
    notasPorId.set(nota.candidata_id, nota);
  }
}
const notas = [...notasPorId.values()];`;
  if (!before.includes(oldBlock)) {
    if (before.includes('const notasPorId = new Map()')) {
      console.log(JSON.stringify({ ok: true, alreadyApplied: true }, null, 2));
      return;
    }
    throw new Error('El codigo de Juntar el lote para el A2 cambio; no publico a ciegas.');
  }

  node.parameters.jsCode = before.replace(oldBlock, newBlock)
    .replace("    notas: notas.slice(i * TAMANO_LOTE_A2, (i + 1) * TAMANO_LOTE_A2)\n", "    notas: notas.slice(i * TAMANO_LOTE_A2, (i + 1) * TAMANO_LOTE_A2),\n    a2_duplicadas_descartadas: duplicadasDescartadas\n");
  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });

  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const active = verified.activeVersion || verified;
  const code = String(active.nodes.find((item) => item.name === nodeName)?.parameters?.jsCode || '');
  if (!code.includes('const notasPorId = new Map()') || !code.includes('a2_duplicadas_descartadas')) {
    throw new Error('La version publicada no contiene la proteccion contra duplicados.');
  }
  console.log(JSON.stringify({ ok: true, workflow: verified.name, activeVersionId: verified.activeVersionId, deduplicacionA2: true }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
