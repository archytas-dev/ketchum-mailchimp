const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta la configuración de ketchum-n8n');
const base = env.N8N_API_URL.replace(/\/$/, '');
(async () => {
  const res = await fetch(`${base}/webhook/v4-armado`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: '99a7b1e3-2b24-4364-a055-be338bfff34a', modo: 'test' }),
  });
  const response = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${response.slice(0, 500)}`);
  console.log(JSON.stringify({ started: true, rehacer: false, response: response.slice(0, 500) }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
