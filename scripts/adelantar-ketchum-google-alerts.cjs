const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
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
  const node = (workflow.nodes || []).find((item) => item.name === 'Cron · mismas ventanas que el barrido');
  if (!node) throw new Error('No existe el cron de Google Alerts.');
  const intervals = node.parameters?.rule?.interval || [];
  const morning = intervals.find((item) => item.field === 'cronExpression' && /\b[67]\b/.test(String(item.expression || '')));
  if (!morning) throw new Error('No se encontró la ventana matinal de Google Alerts.');
  if (morning.expression !== '0 7 * * *' && morning.expression !== '0 6 * * *') throw new Error(`Cron matinal inesperado: ${morning.expression}`);
  morning.expression = '0 6 * * *';
  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const activeNode = (verified.activeVersion || verified).nodes.find((item) => item.name === node.name);
  const expressions = activeNode?.parameters?.rule?.interval?.map((item) => item.expression) || [];
  if (!expressions.includes('0 6 * * *')) throw new Error('La versión activa no tiene Alerts a las 06:00 ART.');
  console.log(JSON.stringify({ workflow: verified.name, google_alerts_art: '06:00', expressions }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
