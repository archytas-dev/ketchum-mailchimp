const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = '4K8k0C1ptXdSiSdB';
const only = 'adrian@archytas.io';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const node = workflow.nodes.find((item) => item.name === 'Guarda dura: modo');
  if (!node) throw new Error('No encontré la guarda de destinatarios.');
  const before = String(node.parameters?.jsCode || '');
  const pattern = /const internos = \[[^\]]*\];/;
  if (!pattern.test(before)) throw new Error('No encontré la lista de destinatarios esperada.');
  node.parameters.jsCode = before.replace(pattern, `const internos = ["${only}"];`);

  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const active = verified.activeVersion?.nodes?.find((item) => item.name === 'Guarda dura: modo');
  const code = String(active?.parameters?.jsCode || '');
  if (!code.includes(`const internos = ["${only}"];`) || /camila@archytas\.io|fede@archytas\.io/.test(code)) {
    throw new Error('No quedó verificado el destinatario único.');
  }
  console.log(JSON.stringify({ workflowId, published: true, recipient: only, activeVersionId: verified.activeVersionId }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
