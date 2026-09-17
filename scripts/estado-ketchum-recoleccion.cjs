const fs = require('fs');
const workflowId = process.argv[2] || 'wEuM4z6hIuLGwQFF';
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };

(async () => {
  const response = await fetch(base + '/api/v1/executions?workflowId=' + encodeURIComponent(workflowId) + '&limit=10', { headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
  const data = JSON.parse(body).data || [];
  console.log(JSON.stringify(data.map(({ id, status, startedAt, stoppedAt, mode, retryOf }) => ({ id, status, startedAt, stoppedAt, mode, retryOf })), null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
