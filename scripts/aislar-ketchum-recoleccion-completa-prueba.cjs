const fs = require('fs');

const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta conexion a n8n Ketchum.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}
function node(workflow, name) {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(`${workflow.name}: falta el nodo ${name}.`);
  return found;
}
async function publish(workflow) {
  await request('/api/v1/workflows/' + workflow.id, { method: 'PUT', body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }) });
  await request('/api/v1/workflows/' + workflow.id + '/publish', { method: 'POST', body: '{}' });
  return request('/api/v1/workflows/' + workflow.id);
}

const collectorConfig = (limit, cap) => `const b = ($json && $json.body) || $json || {};
const limite = Math.min(Math.max(parseInt(b.limite, 10) || ${limit}, 1), ${cap});
const modo = String(b.modo || 'test').toLowerCase() === 'prod' ? 'prod' : 'test';
// Sólo el pedido explícito de prueba completa sale de las vistas diarias.
const scope = String(b.scope || '') === 'completa_prueba' ? 'completa_prueba' : 'diaria';
const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
const p = n => String(n).padStart(2, '0');
const fecha = ahora.getFullYear() + '-' + p(ahora.getMonth() + 1) + '-' + p(ahora.getDate());
const pasada = scope === 'completa_prueba'
  ? 'prueba_completa_' + fecha + '_r0'
  : 'barrido_' + fecha + '_' + p(ahora.getHours());
return [{ json: { limite, modo, scope, pasada, fecha } }];`;

const driverConfig = (limit, max, cap) => `const b = ($json && $json.body) || $json || {};
const limite = Math.min(Math.max(parseInt(b.limite, 10) || ${limit}, 1), ${cap});
const modo = String(b.modo || 'prod').toLowerCase() === 'test' ? 'test' : 'prod';
const scope = String(b.scope || '') === 'completa_prueba' ? 'completa_prueba' : 'diaria';
const maxTandas = Math.min(Math.max(parseInt(b.max_tandas, 10) || ${max}, 1), 40);
const slots = [];
for (let i = 1; i <= maxTandas; i++) slots.push({ json: { tanda: i, limite, modo, scope, maxTandas } });
return slots;`;

(async () => {
  const feedCollector = await request('/api/v1/workflows/tzcHSIUdMGXVRFIo');
  node(feedCollector, 'Config').parameters.jsCode = collectorConfig(60, 120);
  node(feedCollector, 'Leer pendientes del barrido').parameters.url = "=https://banlcbewinpjtudzdzhm.supabase.co/rest/v1/{{ $json.scope === 'completa_prueba' ? 'v4_recoleccion_completa_prueba_pendientes' : 'v4_recoleccion_prioritaria_pendientes' }}?select=fuente_id,dominio_norm,url,formato,transporte,metodo_extraccion&limit={{ $json.limite }}&offset={{ $json.offset || 0 }}";

  const htmlCollector = await request('/api/v1/workflows/p6MFCVE8Ggx65Npq');
  const htmlCollectorNode = node(htmlCollector, 'Config');
  htmlCollectorNode.parameters.jsCode = collectorConfig(10, 30);
  node(htmlCollector, 'Leer fuentes html').parameters.url = "=https://banlcbewinpjtudzdzhm.supabase.co/rest/v1/{{ $json.scope === 'completa_prueba' ? 'v4_recoleccion_html_completa_prueba_pendientes' : 'v4_recoleccion_html_prioritaria_pendientes' }}?select=fuente_id,dominio_norm,url,transporte&limit={{ $json.limite }}";

  const feedDriver = await request('/api/v1/workflows/wEuM4z6hIuLGwQFF');
  node(feedDriver, 'Config').parameters.jsCode = driverConfig(60, 25, 120);
  node(feedDriver, 'Correr una tanda').parameters.jsonBody = "={{ JSON.stringify({ limite: $json.limite, offset: 0, modo: $json.modo, scope: $json.scope }) }}";

  const htmlDriver = await request('/api/v1/workflows/Zm8OhzNmu0uLs2JA');
  node(htmlDriver, 'Config').parameters.jsCode = driverConfig(10, 20, 30);
  node(htmlDriver, 'Correr una tanda').parameters.jsonBody = "={{ JSON.stringify({ limite: $json.limite, modo: $json.modo, muestra: 0, scope: $json.scope }) }}";

  const published = [];
  for (const workflow of [feedCollector, htmlCollector, feedDriver, htmlDriver]) {
    const current = await publish(workflow);
    published.push({ id: current.id, name: current.name, version: current.activeVersionId });
  }
  console.log(JSON.stringify({ published, daily_scope: 'diaria', test_scope: 'completa_prueba' }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
