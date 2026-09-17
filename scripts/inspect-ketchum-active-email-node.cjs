const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
(async () => {
  const res = await fetch(`${base}/api/v1/workflows/ORrmePsGxJJxISTo`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const workflow = await res.json();
  const pick = (nodes) => (nodes || []).find((node) => node.name === 'Armar clipping BMS para email de prueba');
  const draft = pick(workflow.nodes);
  const active = pick(workflow.activeVersion?.nodes);
  console.log(JSON.stringify({
    activeVersionId: workflow.activeVersionId || null,
    hasActiveVersion: !!workflow.activeVersion,
    draftUrl: draft?.parameters?.url || null,
    activeUrl: active?.parameters?.url || null,
    draftBody: draft?.parameters?.jsonBody || null,
    activeBody: active?.parameters?.jsonBody || null,
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
