const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const connection = process.argv[2];
const workflowId = process.argv[3];
if (!connection || !workflowId) throw new Error('Uso: node scripts/inspect-workflow-connection.cjs <conexion> <workflow-id>');
const env = config.mcpServers?.[connection]?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error(`No existe la conexión ${connection}.`);
const base = env.N8N_API_URL.replace(/\/$/, '');
(async () => {
  const response = await fetch(`${base}/api/v1/workflows/${workflowId}`, { headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
  const workflow = JSON.parse(body);
  const active = workflow.activeVersion || workflow;
  const nodes = active.nodes || [];
  console.log(JSON.stringify({
    id: workflow.id, name: workflow.name, active: workflow.active, activeVersionId: workflow.activeVersionId || null,
    executeWorkflowNodes: nodes.filter((n) => /executeWorkflow/i.test(n.type || '')).map((n) => ({ name: n.name, type: n.type, parameters: n.parameters })),
    nodes: nodes.map((n) => ({ name: n.name, type: n.type, disabled: !!n.disabled })),
    connections: active.connections || {},
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
