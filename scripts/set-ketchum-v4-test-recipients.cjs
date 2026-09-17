// Configura la unica salida de correo v4: sigue bloqueada a modo=test y a
// destinatarios internos explicitamente aprobados.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta la conexion ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = '4K8k0C1ptXdSiSdB';
const recipients = ['adrian@archytas.io', 'camila@archytas.io'];
async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}
(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const node = active.nodes.find(n => n.name === 'Guarda dura: modo');
  if (!node) throw new Error('No existe la guarda de destinatarios.');
  const before = String(node.parameters?.jsCode || '');
  const replacement = `const internos = ${JSON.stringify(recipients)};`;
  if (!/const internos = \[[^\]]*\];/.test(before)) throw new Error('Contrato de destinatarios inesperado.');
  node.parameters.jsCode = before.replace(/const internos = \[[^\]]*\];/, replacement);
  await request(`/api/v1/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify({ name: workflow.name, nodes: active.nodes, connections: active.connections || workflow.connections || {}, settings: active.settings || workflow.settings || {} }) });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const code = String((verified.activeVersion || verified).nodes.find(n => n.name === 'Guarda dura: modo')?.parameters?.jsCode || '');
  if (!code.includes(replacement) || !/modo.*test/.test(code) || /fede@archytas\.io/.test(code)) throw new Error('La guarda activa no quedo como se pidio.');
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, modo: 'test-only', recipients }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
