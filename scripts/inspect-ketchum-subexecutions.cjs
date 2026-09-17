const fs = require('fs');
const parentId = process.argv[2];
const workflowId = process.argv[3] || 'E5JLokzkBxeCyLzv';
if (!parentId) throw new Error('Uso: node scripts/inspect-ketchum-subexecutions.cjs <ejecucion-padre> [workflow-id]');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
async function get(path) {
  const response = await fetch(`${base}${path}`, { headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
function findIds(value, path = '$', out = []) {
  if (!value || typeof value !== 'object') return out;
  for (const [key, item] of Object.entries(value)) {
    if (/executionid|subexecution|parentexecution/i.test(key)) out.push({ path: `${path}.${key}`, value: item });
    findIds(item, `${path}.${key}`, out);
  }
  return out;
}
(async () => {
  const parent = await get(`/api/v1/executions/${parentId}?includeData=true`);
  const list = await get(`/api/v1/executions?workflowId=${encodeURIComponent(workflowId)}&limit=100`);
  const children = (list.data || []).filter((e) => String(e.parentId || e.parentExecutionId || '').includes(String(parentId)));
  console.log(JSON.stringify({
    parent: { id: parent.id, status: parent.status, workflowId: parent.workflowId, startedAt: parent.startedAt },
    referenced: findIds(parent),
    children: children.map((e) => ({ id: e.id, status: e.status, startedAt: e.startedAt, stoppedAt: e.stoppedAt, parentId: e.parentId || e.parentExecutionId || null })),
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
