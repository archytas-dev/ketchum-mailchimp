const fs = require('fs');
const executionId = process.argv[2] || '33487';
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');

function items(execution, name) {
  return (execution.data?.resultData?.runData?.[name] || [])
    .flatMap(run => (run.data?.main || []).flat())
    .map(item => item?.json || {})
    .filter(Boolean);
}

(async () => {
  const response = await fetch(`${base}/api/v1/executions/${executionId}?includeData=true`, {
    headers: { 'X-N8N-API-KEY': env.N8N_API_KEY },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 1000)}`);
  const execution = JSON.parse(body);
  const summary = items(execution, 'Resumen')[0] || {};
  const extraction = items(execution, 'Extraer y desenvolver')[0] || {};
  const logs = extraction.logs || [];
  const byDiagnostic = {};
  const byClient = {};
  for (const row of logs) {
    byDiagnostic[row.diagnostico || 'sin_diagnostico'] = (byDiagnostic[row.diagnostico || 'sin_diagnostico'] || 0) + 1;
    const client = row.cliente || row.slug || 'no_informado';
    byClient[client] = (byClient[client] || 0) + 1;
  }
  console.log(JSON.stringify({
    executionId,
    mode: summary.modo || extraction.modo,
    pasada: summary.pasada || extraction.pasada,
    alerts: summary.alertas || extraction.alertas || logs.length,
    notes: summary.notas_traidas || extraction.notas_traidas || 0,
    byDiagnostic,
    byClient,
    fetchLogWritten: summary.fetch_log_escrito,
    poolWritten: summary.pool_escrito,
    failedTopics: logs.filter(row => row.diagnostico !== 'ok').map(row => ({ alerta_id: row.dominio_norm, diagnostico: row.diagnostico, status: row.http_status, articles: row.articulos })),
  }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
