const fs = require('fs');
const id = process.argv[2];
if (!id) throw new Error('Uso: node scripts/audit-ketchum-page.cjs <execution-id>');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
function itemsOf(run) { return run?.data?.main?.flat()?.flat() || []; }
(async () => {
  const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const execution = await response.json();
  const data = execution.data?.resultData?.runData || {};
  const nodeStats = Object.fromEntries(Object.entries(data).map(([name, runs]) => [name, {
    vueltas: runs.length,
    ms: runs.reduce((sum, r) => sum + (Number(r.executionTime) || 0), 0),
    items: runs.reduce((sum, r) => sum + itemsOf(r).length, 0),
  }]));
  const a1 = (data['A1 completador'] || []).flatMap(itemsOf).map((x) => x.json || {});
  const a2 = (data['A2 juez'] || []).flatMap(itemsOf).map((x) => x.json || {});
  console.log(JSON.stringify({
    id, status: execution.status, startedAt: execution.startedAt, stoppedAt: execution.stoppedAt,
    page: (data['Tomar pagina'] || []).at(-1)?.data?.main?.[0]?.[0]?.json || null,
    leer_lote: (data['Leer lote'] || []).at(-1)?.data?.main?.[0]?.[0]?.json || null,
    preparar_lote: (data['Preparar lote'] || []).at(-1)?.data?.main?.[0]?.[0]?.json || null,
    juntar_a2: (data['Juntar el lote para el A2'] || []).at(-1)?.data?.main?.[0]?.[0]?.json || null,
    siguiente: (data['Disparar pagina siguiente'] || []).at(-1)?.data?.main?.[0]?.[0]?.json || null,
    siguiente_raw: (data['Disparar pagina siguiente'] || []).at(-1)?.data?.main?.[0]?.[0] || null,
    a1: { notas: a1.length, abrio_pagina: a1.filter((x) => x.se_abrio).length, sin_copete: a1.filter((x) => !String(x.snippet || '').trim()).length },
    a2: { veredictos: a2.length, entran: a2.filter((x) => x.entra === true).length },
    nodeStats,
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
