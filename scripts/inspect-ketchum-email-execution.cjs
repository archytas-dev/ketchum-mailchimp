const fs = require('fs');
const id = process.argv[2];
if (!id) throw new Error('Uso: node scripts/inspect-ketchum-email-execution.cjs <execution-id>');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
function one(data, name) { return data?.[name]?.at(-1)?.data?.main?.[0]?.[0]?.json || null; }
(async () => {
  const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const execution = await response.json();
  const data = execution.data?.resultData?.runData || {};
  const clipping = one(data, 'Armar clipping para email de prueba') || one(data, 'Armar clipping BMS para email de prueba');
  const configNode = one(data, 'Config');
  const email = one(data, 'Preparar email v3 de prueba') || one(data, 'Preparar email BMS de prueba');
  const secciones = clipping?.secciones || [];
  const notas = secciones.flatMap((s) => (s.notas || []).map((n) => ({ ...n, __seccion: s.nombre })));
  const valorDescripcion = (n) => n.descripcion ?? n.description ?? n.snippet ?? n.copete ?? n.resumen ?? n.bajada ?? '';
  const dominio = (n) => { try { return new URL(n.url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const exclusivas = secciones.filter((s) => /exclusiva|producto/i.test(String(s.nombre || '')))
    .map((s) => ({ seccion: s.nombre, notas: s.notas || [] }));
  console.log(JSON.stringify({
    id, status: execution.status, startedAt: execution.startedAt, stoppedAt: execution.stoppedAt,
    config: configNode, lastNode: execution.data?.resultData?.lastNodeExecuted || null,
    error: execution.data?.resultData?.error?.message || null,
    clipping: clipping ? {
      total_notas: clipping.total_notas,
      secciones: secciones.map((s) => ({ nombre: s.nombre, cantidad: s.cantidad })),
      notas_sin_descripcion: notas.filter((n) => !String(valorDescripcion(n)).trim()).length,
      notas_con_tier: notas.filter((n) => n.tier !== null && n.tier !== undefined && String(n.tier).trim() !== '').length,
      notas_con_alcance: notas.filter((n) => n.alcance !== null && n.alcance !== undefined && String(n.alcance).trim() !== '').length,
      notas_con_ad_value: notas.filter((n) => n.ad_value !== null && n.ad_value !== undefined && String(n.ad_value).trim() !== '').length,
      titulos_repetidos: Object.entries(notas.reduce((acc, n) => { const t = String(n.titulo || '').trim().toLowerCase(); if (t) acc[t] = (acc[t] || 0) + 1; return acc; }, {})).filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([titulo, count]) => ({ titulo, count })),
      dominios: Object.entries(notas.reduce((acc, n) => { const d = dominio(n); acc[d] = (acc[d] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 20),
      etiquetas: Object.entries(notas.reduce((acc, n) => { const e = String(n.etiqueta || ''); acc[e] = (acc[e] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]),
      campos_nota: [...new Set(notas.flatMap((n) => Object.keys(n).filter((k) => k !== '__seccion')))].sort(),
      ejemplos: notas.slice(0, 8).map((n) => ({ seccion: n.__seccion, titulo: n.titulo, url: n.url, descripcion: valorDescripcion(n), keyword_match: n.keyword_match, grupo: n.grupo, etiqueta: n.etiqueta, tier: n.tier, alcance: n.alcance, ad_value: n.ad_value })),
    } : null,
    exclusivas,
    email: email ? { para: email.para, asunto: email.asunto, total_notas: email.total_notas } : null,
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
