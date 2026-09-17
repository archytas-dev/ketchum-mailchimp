const fs = require('fs');
const clients = {
  mars: '145311f2-79a0-430b-b528-c9683d1e196f',
  booking: '65170cb4-0646-4602-b5b5-f1b93e6762d4',
  msd: '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026',
  bms: '99a7b1e3-2b24-4364-a055-be338bfff34a',
};
const slug = String(process.argv[2] || '').toLowerCase();
const clientId = clients[slug];
const modoArg = String(process.argv[process.argv.indexOf('--modo') + 1] || 'test').toLowerCase();
const modo = modoArg === 'prod' ? 'prod' : 'test';
if (!clientId) throw new Error(`Uso: node scripts/monitor-ketchum-clipping-test.cjs <${Object.keys(clients).join('|')}>`);
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
async function get(path) {
  const response = await fetch(`${base}${path}`, { headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
async function allExecutions() {
  const out = [];
  let cursor = null;
  do {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const page = await get(`/api/v1/executions?workflowId=ORrmePsGxJJxISTo&limit=100${suffix}`);
    out.push(...(page.data || []));
    cursor = page.nextCursor || null;
  } while (cursor);
  return out;
}
function one(data, name) { return data?.[name]?.at(-1)?.data?.main?.[0]?.[0]?.json || null; }
(async () => {
  // La prueba recién iniciada siempre está entre las últimas ejecuciones. Pedir
  // muchas a n8n vuelve esta verificación innecesariamente lenta.
  const list = { data: await allExecutions() };
  const rows = [];
  for (const e of list.data || []) {
    const detail = await get(`/api/v1/executions/${e.id}?includeData=true`);
    const data = detail.data?.resultData?.runData || {};
    const cfg = one(data, 'Config');
    if (cfg?.client_id !== clientId || cfg?.modo !== modo) continue;
    const page = one(data, 'Tomar pagina');
    const done = one(data, 'Terminar pagina');
    const prepared = one(data, 'Preparar email v3 de prueba');
    const sent = one(data, 'Enviar email v3 de prueba');
    rows.push({ id: e.id, status: e.status, startedAt: e.startedAt, stoppedAt: e.stoppedAt,
      pagina: page?.pagina ?? null, candidatas: page?.candidatas ?? null, has_more: done?.has_more ?? null,
      lastNode: detail.data?.resultData?.lastNodeExecuted || null,
      error: detail.data?.resultData?.error?.message || null,
      email: prepared ? { para: prepared.para, notas: prepared.total_notas, html_bytes: String(prepared.html || '').length } : null,
      send: sent?.output?.[0]?.json || sent?.json || null,
    });
    if (rows.length >= 8 && !process.argv.includes('--all')) break;
  }
  console.log(JSON.stringify({ client: slug, modo, rows }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
