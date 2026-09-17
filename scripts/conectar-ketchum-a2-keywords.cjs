const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const id = '9pwrSH2KdpGhbXjS';
const mainId = 'ORrmePsGxJJxISTo';

async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error((options.method || 'GET') + ' ' + path + ': HTTP ' + response.status + ': ' + text.slice(0, 600));
  return text ? JSON.parse(text) : {};
}

(async () => {
  const workflow = await request('/api/v1/workflows/' + id);
  const node = workflow.nodes.find((n) => n.name === 'Armar el pedido');
  if (!node) throw new Error('No encontre Armar el pedido.');
  const before = String(node.parameters?.jsCode || '');
  const oldLine = "keyword_match: '', grupo: '', etiqueta: n.es_prioritaria ? 'PRIORITARIA' : ''";
  const legacyLine = "keyword_match: String(n.keyword_match || ''), grupo: String(n.grupo || ''), etiqueta: n.es_prioritaria ? 'PRIORITARIA' : ''";
  const newLine = "keyword_match: String(n.keyword_match || ''), grupo: String(n.grupo || ''), etiqueta: String(n.etiqueta || (n.es_prioritaria ? 'PRIORITARIA' : ''))";
  if (!before.includes(oldLine) && !before.includes(legacyLine) && !before.includes(newLine)) throw new Error('El contrato de A2 cambio; no publico a ciegas.');
  node.parameters.jsCode = before.replace(oldLine, newLine).replace(legacyLine, newLine);
  await request('/api/v1/workflows/' + id, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }),
  });
  await request('/api/v1/workflows/' + id + '/publish', { method: 'POST', body: '{}' });
  const verified = await request('/api/v1/workflows/' + id);
  const active = verified.activeVersion || verified;
  const code = String(active.nodes.find((n) => n.name === 'Armar el pedido')?.parameters?.jsCode || '');
  if (!code.includes(newLine)) throw new Error('La version activa no recibio keyword_match/grupo.');

  const main = await request('/api/v1/workflows/' + mainId);
  const preparar = main.nodes.find((n) => n.name === 'Preparar lote');
  const juntar = main.nodes.find((n) => n.name === 'Juntar el lote para el A2');
  if (!preparar || !juntar) throw new Error('No encontre los nodos que llevan las notas al A2.');
  const prepararCode = String(preparar.parameters?.jsCode || '');
  const juntarCode = String(juntar.parameters?.jsCode || '');
  const prepararOld = "  transporte: f.transporte || 'directo'\n";
  const prepararLegacy = "  transporte: f.transporte || 'directo',\n  keyword_match: String(f.keyword_match || ''), grupo: String(f.grupo || '')\n";
  const prepararNew = "  transporte: f.transporte || 'directo',\n  keyword_match: String(f.keyword_match || ''), grupo: String(f.grupo || ''), etiqueta: String(f.etiqueta || '')\n";
  const juntarOld = "    es_prioritaria: !!p.es_prioritaria\n";
  const juntarLegacy = "    es_prioritaria: !!p.es_prioritaria,\n    keyword_match: String(p.keyword_match || ''), grupo: String(p.grupo || '')\n";
  const juntarNew = "    es_prioritaria: !!p.es_prioritaria,\n    keyword_match: String(p.keyword_match || ''), grupo: String(p.grupo || ''), etiqueta: String(p.etiqueta || '')\n";
  if (!prepararCode.includes(prepararOld) && !prepararCode.includes(prepararLegacy) && !prepararCode.includes(prepararNew)) throw new Error('Cambio inesperado en Preparar lote; no publico a ciegas.');
  if (!juntarCode.includes(juntarOld) && !juntarCode.includes(juntarLegacy) && !juntarCode.includes(juntarNew)) throw new Error('Cambio inesperado en Juntar el lote para el A2; no publico a ciegas.');
  preparar.parameters.jsCode = prepararCode.replace(prepararOld, prepararNew).replace(prepararLegacy, prepararNew);
  juntar.parameters.jsCode = juntarCode.replace(juntarOld, juntarNew).replace(juntarLegacy, juntarNew);
  const savedMain = await request('/api/v1/workflows/' + mainId, {
    method: 'PUT',
    body: JSON.stringify({ name: main.name, nodes: main.nodes, connections: main.connections, settings: main.settings || {} }),
  });
  await request('/api/v1/workflows/' + mainId + '/publish', { method: 'POST', body: '{}' });
  const verifiedMain = await request('/api/v1/workflows/' + mainId);
  const activeMain = verifiedMain.activeVersion || verifiedMain;
  const activePreparar = activeMain.nodes.find((n) => n.name === 'Preparar lote');
  const activeJuntar = activeMain.nodes.find((n) => n.name === 'Juntar el lote para el A2');
  if (!String(activePreparar?.parameters?.jsCode || '').includes('keyword_match') || !String(activeJuntar?.parameters?.jsCode || '').includes('keyword_match')) throw new Error('La version activa del armado no recibio keyword_match.');
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, keywords: true, main: savedMain.id, mainActiveVersionId: verifiedMain.activeVersionId }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
