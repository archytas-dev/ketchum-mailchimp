const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\\.claude.json', 'utf8'));
const v3Env = config.mcpServers?.['archytas-n8n']?.env;
const v4Env = config.mcpServers?.['ketchum-n8n']?.env;

function connection(env) {
  if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta configuración de n8n.');
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}

const v3 = connection(v3Env);
const v4 = connection(v4Env);

async function get(conn, path) {
  const response = await fetch(`${conn.base}${path}`, { headers: conn.headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n ${path}: HTTP ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

function nodeItems(execution, name) {
  const runs = execution.data?.resultData?.runData?.[name] || [];
  return runs.flatMap(run => (run.data?.main || []).flat()).map(item => item?.json || {}).filter(Boolean);
}

function clean(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

function domain(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\\./, ''); } catch { return clean(value).split('/')[0]; }
}

function urlKey(value) {
  try {
    const u = new URL(value);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return `${u.hostname}${u.pathname}${u.search}`;
  } catch { return clean(value); }
}

function latestRun(execution, name) {
  const items = nodeItems(execution, name);
  return items.length ? items : [];
}

async function main() {
  const windowUtc = process.argv.find(arg => arg.startsWith('--window-utc='))?.split('=')[1] || '2026-09-11T14:00:00.000Z';
  const windowStart = new Date(windowUtc);
  const windowEnd = new Date(windowStart.getTime() + 15 * 60 * 1000);
  const [v3Execution, v4AlertExecution, v4FeedExecutions, v4HtmlExecutions] = await Promise.all([
    get(v3, '/api/v1/executions/209769?includeData=true'),
    get(v4, '/api/v1/executions/33469?includeData=true'),
    get(v4, '/api/v1/executions?workflowId=tzcHSIUdMGXVRFIo&limit=100'),
    get(v4, '/api/v1/executions?workflowId=p6MFCVE8Ggx65Npq&limit=100'),
  ]);

  const v3Sources = latestRun(v3Execution, 'Read Sitios Monitoreados');
  const v3Alerts = latestRun(v3Execution, 'Read Google Alerts');
  const v4Alerts = latestRun(v4AlertExecution, 'Leer alertas pendientes');

  // El barrido de las 14:00 ART empezó a las 17:00 UTC. Cada tanda es una
  // ejecución hija; juntarlas permite ver el universo realmente intentado.
  const childExecutions = (v4FeedExecutions.data || [])
    .filter(x => new Date(x.startedAt) >= windowStart && new Date(x.startedAt) < windowEnd)
    .map(x => x.id);
 const htmlWindowStart = new Date(windowStart.getTime() + 15 * 60 * 1000);
  const htmlWindowEnd = new Date(windowStart.getTime() + 30 * 60 * 1000);
  const htmlChildExecutions = (v4HtmlExecutions.data || [])
    .filter(x => new Date(x.startedAt) >= htmlWindowStart && new Date(x.startedAt) < htmlWindowEnd)
    .map(x => x.id);
  const childDetails = [];
  for (const id of childExecutions) {
    try { childDetails.push(await get(v4, `/api/v1/executions/${id}?includeData=true`)); } catch { /* la tanda fallida se informa aparte */ }
  }
  const htmlChildDetails = [];
  for (const id of htmlChildExecutions) {
    try { htmlChildDetails.push(await get(v4, `/api/v1/executions/${id}?includeData=true`)); } catch { /* la tanda fallida se informa aparte */ }
  }
  const v4Sources = childDetails.concat(htmlChildDetails)
    .flatMap(execution => latestRun(execution, 'Armar pedidos'));

  const v4ByDomain = new Map();
  for (const row of v4Sources) {
    const key = row.dominio_norm || domain(row.url);
    if (!key) continue;
    const list = v4ByDomain.get(key) || [];
    list.push({ url: row.url, formato: row.formato, transporte: row.transporte, metodo_extraccion: row.metodo_extraccion });
    v4ByDomain.set(key, list);
  }

  const sourceRows = v3Sources.map(row => ({
    dominio: clean(row.dominio),
    nombre: row.nombre || null,
    url_v3: row.url_feed || null,
    metodo_v3: row.metodo || null,
    estado_v4: v4ByDomain.has(clean(row.dominio)) ? 'aparece_en_barrido_v4' : 'no_aparece_en_barrido_v4',
    accesos_v4: v4ByDomain.get(clean(row.dominio)) || [],
  }));

  const v3AlertByUrl = new Map(v3Alerts.map(row => [urlKey(row.url_alerta_rss || row.url || row.url_rss), row]));
  const v4AlertByUrl = new Map(v4Alerts.map(row => [urlKey(row.url || row.url_alerta_rss || row.url_rss), row]));
  const alertasFaltantes = v3Alerts
    .filter(row => !v4AlertByUrl.has(urlKey(row.url_alerta_rss || row.url || row.url_rss)))
    .map(row => ({ tema: row.tema, url: row.url_alerta_rss || row.url || row.url_rss }));
  const alertasComunes = v3Alerts.filter(row => v4AlertByUrl.has(urlKey(row.url_alerta_rss || row.url || row.url_rss))).length;

  const resumenFuentes = sourceRows.reduce((acc, row) => {
    acc[row.estado_v4] = (acc[row.estado_v4] || 0) + 1;
    return acc;
  }, {});
  const transportes = {};
  for (const row of v4Sources) transportes[row.transporte || 'sin_transporte'] = (transportes[row.transporte || 'sin_transporte'] || 0) + 1;

  const compact = {
    comparacion: {
      ejecucion_v3: '209769',
      ejecucion_alertas_v4: '33469',
      child_executions_v4: childExecutions.length,
      html_child_executions_v4: htmlChildExecutions.length,
      fuentes_v4_revisadas: v4Sources.length,
      nota_barrido: 'El barrido 14 ART falló en la última tanda; por eso sus fuentes no sirven todavía como inventario total del catálogo.',
    },
    google_alerts_bms: {
      v3: v3Alerts.length,
      v4_leidas_en_ultima_corrida: v4Alerts.length,
      comunes_por_url_rss: alertasComunes,
      faltantes_en_v4_test: alertasFaltantes.map(row => row.tema),
      presentes_en_v4_test: v4Alerts.map(row => row.tema),
    },
    transportes_observados_en_las_tandas_v4: transportes,
    fuentes_v3_que_no_aparecen_en_las_tandas_v4: [...new Map(
      sourceRows.filter(row => row.estado_v4 === 'no_aparece_en_barrido_v4')
        .map(row => [row.dominio, { dominio: row.dominio, nombre: row.nombre, url_v3: row.url_v3 }])
    ).values()],
  };

  if (process.argv.includes('--compact')) {
    console.log(JSON.stringify(compact, null, 2));
    return;
  }

  console.log(JSON.stringify({
    comparacion: {
      ejecucion_v3: '209769',
      ejecucion_alertas_v4: '33469',
      barrido_v4_ventana_utc: windowUtc,
      barrido_v4_child_executions: childExecutions,
    },
    fuentes_monitoreadas: {
      v3_filas: v3Sources.length,
      v4_filas_revisadas: v4Sources.length,
      resumen: resumenFuentes,
      faltantes_por_dominio: sourceRows.filter(row => row.estado_v4 === 'no_aparece_en_barrido_v4'),
      transportes_en_barrido_v4: transportes,
    },
    google_alerts_bms: {
      v3: v3Alerts.length,
      v4_leidas_en_ultima_corrida: v4Alerts.length,
      comunes_por_url_rss: alertasComunes,
      faltantes_en_v4_test: alertasFaltantes,
      nota: 'La V4 devuelve alertas pendientes, no necesariamente todo el catálogo. Si una alerta ya fue procesada en esa ventana no vuelve a aparecer; el número de configuración total debe confirmarse contra public.google_alerts.',
    },
  }, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
