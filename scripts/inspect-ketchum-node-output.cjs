const fs = require('fs');
const [id, node] = process.argv.slice(2);
if (!id || !node) throw new Error('Uso: node scripts/inspect-ketchum-node-output.cjs <ejecucion> <nodo>');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
(async () => {
  const response = await fetch(`${env.N8N_API_URL.replace(/\/$/, '')}/api/v1/executions/${id}?includeData=true`, {
    headers: { 'X-N8N-API-KEY': env.N8N_API_KEY },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()).data?.resultData?.runData || {};
  const runs = data[node] || [];
  console.log(JSON.stringify({ id, node, runs: runs.map((run, index) => ({
    index,
    status: run.executionStatus || null,
    error: run.error?.message || null,
    items: (run.data?.main || []).flat().map(item => item?.json || null),
  })) }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
