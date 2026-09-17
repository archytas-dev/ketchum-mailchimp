const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
const id = process.argv[2];
const pattern = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
if (!id) throw new Error('Uso: node scripts/inspect-ketchum-workflow.cjs <workflow-id> [patron]');
(async () => {
  const response = await fetch(`${base}/api/v1/workflows/${id}`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const workflow = await response.json();
  const active = workflow.activeVersion || workflow;
  const nodes = active.nodes || [];
  if (pattern) {
    const matches = nodes.filter((node) => pattern.test(node.name) || pattern.test(JSON.stringify(node.parameters || {}))).map((node) => ({ name: node.name, type: node.type, disabled: !!node.disabled, parameters: node.parameters }));
    const links = process.argv.includes('--links') ? Object.fromEntries(
      Object.entries(active.connections || {}).filter(([source]) => matches.some((node) => node.name === source))
    ) : undefined;
    console.log(JSON.stringify({ id, name: workflow.name, active: workflow.active, activeVersionId: workflow.activeVersionId || null, matches, ...(links ? { links } : {}) }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    id,
    name: workflow.name,
    active: workflow.active,
    activeVersionId: workflow.activeVersionId || null,
    nodes: nodes.map((node) => ({ name: node.name, type: node.type, disabled: !!node.disabled, parameters: node.parameters?.rule || node.parameters?.batchSize ? node.parameters : undefined })),
    connections: active.connections || {},
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
