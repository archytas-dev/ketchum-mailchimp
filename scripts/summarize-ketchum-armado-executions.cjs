const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
function json(data, name) { return (data[name] || []).at(-1)?.data?.main?.[0]?.[0]?.json || null; }

(async () => {
  const list = await get('/api/v1/executions?workflowId=ORrmePsGxJJxISTo&limit=30');
  const rows = [];
  for (const entry of list.data || []) {
    const execution = await get(`/api/v1/executions/${entry.id}?includeData=true`);
    const result = execution.data?.resultData || {};
    const data = result.runData || {};
    const cfg = json(data, 'Config');
    const page = json(data, 'Tomar pagina');
    const finish = json(data, 'Terminar pagina');
    const close = json(data, 'Cerrar corrida');
    rows.push({
      id: entry.id, status: entry.status, mode: entry.mode, startedAt: entry.startedAt, stoppedAt: entry.stoppedAt,
      client_id: cfg?.client_id || null, modo: cfg?.modo || null, rehacer: cfg?.rehacer ?? null, limite_prueba: cfg?.limite ?? null,
      pagina: page?.pagina ?? null, candidatas_pagina: page?.candidatas ?? null,
      pagina_estado: finish?.estado_pagina ?? null, quedan_paginas: finish?.has_more ?? null,
      cerro: !!close, lastNode: result.lastNodeExecuted || null, error: result.error?.message || null,
    });
  }
  console.log(JSON.stringify(rows, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
