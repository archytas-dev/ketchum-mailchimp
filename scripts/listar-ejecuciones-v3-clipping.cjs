const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['archytas-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
const workflows = {
  bms: 'bgabQ3ICjdex0ppC',
  bms_alternativo: 'hLi9wQAgZ0Z5HlSe',
  booking: 'Km1e6ZWLYEl9hQRV',
  booking_alternativo: 'fmSygwIDbpxm8Ubq',
  mars: 'VwGjBYNQvi51ZhR7',
  mars_alternativo: 'nXD0RHy6q69cTrT2',
  msd: '19NPw3POuwTKdUsK',
  msd_alternativo: 'gXXA9qIJ844k6OUs',
};
(async () => {
  const out = {};
  for (const [slug, id] of Object.entries(workflows)) {
    const response = await fetch(`${base}/api/v1/executions?workflowId=${id}&limit=10`, { headers });
    if (!response.ok) throw new Error(`${slug}: HTTP ${response.status}`);
    const data = (await response.json()).data || [];
    out[slug] = data.map(({ id, status, startedAt, stoppedAt, mode }) => ({ id, status, startedAt, stoppedAt, mode }));
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
