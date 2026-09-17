const fs = require('fs');
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('Uso: node scripts/auditar-ketchum-emails-enviados.cjs <ejecucion-email>...');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
function item(data, name) { return data?.[name]?.at(-1)?.data?.main?.[0]?.[0]?.json || null; }

(async () => {
  const out = [];
  for (const id of ids) {
    const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
    if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
    const execution = await response.json();
    const data = execution.data?.resultData?.runData || {};
    const guard = item(data, 'Preparar email v3 de prueba') || item(data, 'Guarda dura: modo') || {};
    const html = String(guard.html || '');
    const resumen = {
      id, status: execution.status, cliente: guard.cliente || null, para: guard.para || null,
      asunto: guard.asunto || null, bytes_html: html.length,
      tier_visible: (html.match(/Tier\s*:/gi) || []).length,
      alcance_visible: (html.match(/Alcance\s*:/gi) || []).length,
      ad_value_visible: (html.match(/Ad\.?\s*Value\s*:/gi) || []).length,
      tier_dentro_de_url: (html.match(/href="[^"]*Tier\s*:/gi) || []).length,
    };
    out.push(process.argv.includes('--html') ? { ...resumen, html } : resumen);
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
