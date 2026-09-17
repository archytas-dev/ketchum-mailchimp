const fs = require('fs');
const id = process.argv[2];
if (!id) throw new Error('Uso: node scripts/leer-error-ketchum-ejecucion.cjs <id>');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };

(async () => {
  const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const execution = await response.json();
  const result = execution.data?.resultData || {};
  const runData = result.runData || {};
  const nodes = Object.entries(runData).map(([name, runs]) => {
    const last = runs.at(-1) || {};
    return { name, error: last.error?.message || null, executionStatus: last.executionStatus || null };
  }).filter((node) => node.error || node.executionStatus === 'error');
  console.log(JSON.stringify({ id: execution.id, status: execution.status, lastNode: result.lastNodeExecuted, error: result.error?.message || null, nodes }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
