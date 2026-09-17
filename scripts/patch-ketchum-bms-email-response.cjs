const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const id = 'ORrmePsGxJJxISTo';
(async () => {
  const get = await fetch(`${base}/api/v1/workflows/${id}`, { headers });
  if (!get.ok) throw new Error(`GET HTTP ${get.status}`);
  const workflow = await get.json();
  const node = workflow.nodes.find((item) => item.name === 'Preparar email BMS de prueba');
  const before = String(node?.parameters?.jsCode || '');
  const after = before.includes('const respuesta = $json || {};')
    ? before
    : before.replace('const clipping = $json || {};', 'const respuesta = $json || {};\nconst clipping = respuesta.body || respuesta;');
  if (!after.includes('const respuesta = $json || {};')) throw new Error('No encontré el formato esperado para corregir.');
  node.parameters.jsCode = after;
  node.parameters.url = 'https://banlcbewinpjtudzdzhm.supabase.co/rest/v1/rpc/armar_clipping';
  const put = await fetch(`${base}/api/v1/workflows/${id}`, { method: 'PUT', headers, body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }) });
  const text = await put.text();
  if (!put.ok) throw new Error(`PUT HTTP ${put.status}: ${text.slice(0, 500)}`);
  const publish = await fetch(`${base}/api/v1/workflows/${id}/publish`, { method: 'POST', headers, body: '{}' });
  const publishText = await publish.text();
  if (!publish.ok) throw new Error(`PUBLISH HTTP ${publish.status}: ${publishText.slice(0, 500)}`);
  console.log(JSON.stringify({ corrected: true, published: true, active: JSON.parse(text).active }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
