const fs = require('fs');
const id = process.argv[2];
if (!id) throw new Error('Uso: node scripts/nodos-ejecucion-v3.cjs <id>');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['archytas-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
(async () => {
  const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const execution = await response.json();
  const data = execution.data?.resultData?.runData || {};
  const target = process.argv[3];
  if (target) {
    const runs = data[target] || [];
    if (process.argv.includes('--list')) {
      const rows = runs.flatMap(run => (run?.data?.main || []).flat()).map(item => item?.json || {});
      const keys = target === 'Read Google Alerts'
        ? ['tema', 'url_alerta_rss', 'activa']
        : ['dominio', 'nombre', 'origen', 'metodo', 'metodo_detectado', 'url_feed', 'activo', 'notas_total'];
      console.log(JSON.stringify({ id, node: target, cantidad: rows.length,
        items: rows.map(row => Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key]]))) }, null, 2));
      return;
    }
    const compactRun = (run, index) => {
      const item = run?.data?.main?.[0]?.[0]?.json || {};
      return { index, output: Object.fromEntries(Object.entries(item).map(([key, value]) => [key, typeof value === 'string' ? { chars: value.length, inicio: value.slice(0, 300) } : value])) };
    };
    console.log(JSON.stringify({ id, node: target, runs: runs.map(compactRun) }, null, 2));
    return;
  }
  console.log(JSON.stringify({ id, lastNode: execution.data?.resultData?.lastNodeExecuted, nodes: Object.keys(data), error: execution.data?.resultData?.error?.message || null }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
