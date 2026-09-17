const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'nvShglwLuHqgF5cp';
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : null;
}
(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const node = (workflow.nodes || []).find(n => n.name === 'Config');
  if (!node) throw new Error('Falta Config.');
  const code = String(node.parameters?.jsCode || '');
  const oldReturn = 'clientId, grupo, limite, offset, modo,\n  pasada:';
  const newReturn = 'clientId, grupo, limite, offset, modo, dominios,\n  pasada:';
  if (!code.includes(newReturn)) {
    if (!code.includes(oldReturn)) throw new Error('No encontré el retorno esperado.');
    node.parameters.jsCode = code.replace(oldReturn, newReturn);
  }
  await request(`/api/v1/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }) });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const activeNode = (verified.activeVersion || verified).nodes.find(n => n.name === 'Config');
  if (!String(activeNode?.parameters?.jsCode || '').includes(newReturn)) throw new Error('La versión activa no conserva dominios en Config.');
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, domainFilterReturned: true }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
