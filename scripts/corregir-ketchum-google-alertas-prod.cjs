const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'WfKUwnGWabKVMFo9';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : null;
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const node = (workflow.nodes || []).find((n) => n.name === 'Config');
  if (!node) throw new Error('No existe el nodo Config de Google Alerts.');
  const before = String(node.parameters?.jsCode || '');
  const oldText = "String(b.modo || 'test').toLowerCase() === 'prod' ? 'prod' : 'test'";
  const newText = "String(b.modo || 'prod').toLowerCase() === 'test' ? 'test' : 'prod'";
  if (!before.includes(oldText) && !before.includes(newText)) throw new Error('El contrato de modo cambio; no se publica a ciegas.');
  node.parameters.jsCode = before.replace(oldText, newText);
  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const code = String((verified.activeVersion || verified).nodes.find((n) => n.name === 'Config')?.parameters?.jsCode || '');
  if (!code.includes(newText)) throw new Error('La version activa no deja Google Alerts en prod por defecto.');
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, cronWritesPool: true }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
