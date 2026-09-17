const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
(async () => {
  const r = await fetch(env.N8N_API_URL.replace(/\/$/, '') + '/api/v1/workflows?limit=250', { headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const b = await r.json(); const rows = b.data || b;
  const out = [];
  for (const x of rows) {
    const q = await fetch(env.N8N_API_URL.replace(/\/$/, '') + '/api/v1/workflows/' + x.id, { headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } });
    if (!q.ok) continue;
    const w = await q.json(); const a = w.activeVersion || w;
    if ((a.nodes || []).some(n => String(n.parameters?.path || '') === 'v4-test-open')) out.push({ id:w.id, name:w.name });
  }
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
