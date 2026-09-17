const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
function conn(name) {
  const env = config.mcpServers?.[name]?.env;
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}
async function get(c, id) {
  const response = await fetch(`${c.base}/api/v1/executions/${id}?includeData=true`, { headers: c.headers });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  return response.json();
}
function one(data, node) { return data?.[node]?.at(-1)?.data?.main?.[0]?.[0]?.json || {}; }
function clean(value) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function unwrap(value) {
  let current = clean(value);
  for (let i = 0; i < 3; i += 1) {
    try {
      const parsed = new URL(current);
      const target = ['url', 'q', 'u', 'redirect'].map((key) => parsed.searchParams.get(key)).find(Boolean);
      if (!target) break;
      current = decodeURIComponent(target);
    } catch { break; }
  }
  return current;
}
function canonUrl(value) {
  try {
    const parsed = new URL(unwrap(value));
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|mc_|ref$)/i.test(key)) parsed.searchParams.delete(key);
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return parsed.toString();
  } catch { return unwrap(value).toLowerCase().replace(/\/$/, ''); }
}
function normTitle(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function v3Notes(data) {
  const notes = one(data, 'Prep Supabase Rows').notes || [];
  return notes.map((n) => ({ titulo: n.titulo || n.title, url: n.url, medio: n.medio, seccion: n.seccion || n.grupo, origen: n.origen }));
}
function v4Notes(data) {
  const clipping = one(data, 'Armar clipping para email de prueba');
  return (clipping.secciones || []).flatMap((s) => (s.notas || []).map((n) => ({ ...n, seccion: s.nombre })));
}
function index(rows, key) { return new Map(rows.map((n) => [key(n), n])); }
function domain(row) { try { return new URL(unwrap(row.url)).hostname.replace(/^www\./, ''); } catch { return ''; } }
(async () => {
  const v3Id = process.argv[2] || '209769';
  const v4Id = process.argv[3] || '33476';
  const [old, current] = await Promise.all([get(conn('archytas-n8n'), v3Id), get(conn('ketchum-n8n'), v4Id)]);
  const oldRows = v3Notes(old.data?.resultData?.runData || {});
  const newRows = v4Notes(current.data?.resultData?.runData || {});
  const oldUrl = index(oldRows, (n) => canonUrl(n.url));
  const newUrl = index(newRows, (n) => canonUrl(n.url));
  const oldTitle = index(oldRows, (n) => normTitle(n.titulo));
  const newTitle = index(newRows, (n) => normTitle(n.titulo));
  const commonUrl = [...newUrl.keys()].filter((k) => k && oldUrl.has(k));
  const commonTitle = [...newTitle.keys()].filter((k) => k && oldTitle.has(k));
  const onlyOld = oldRows.filter((n) => !newUrl.has(canonUrl(n.url)) && !newTitle.has(normTitle(n.titulo)));
  const onlyNew = newRows.filter((n) => !oldUrl.has(canonUrl(n.url)) && !oldTitle.has(normTitle(n.titulo)));
  const byDomain = (rows) => Object.fromEntries([...rows.reduce((m, n) => m.set(domain(n), (m.get(domain(n)) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]));
  console.log(JSON.stringify({
    v3: { ejecucion: v3Id, notas: oldRows.length, por_dominio: byDomain(oldRows) },
    v4: { ejecucion: v4Id, notas: newRows.length, por_dominio: byDomain(newRows) },
    comunes: { por_url: commonUrl.length, por_titulo: commonTitle.length },
    solo_v3: onlyOld.slice(0, 50),
    solo_v4: onlyNew.slice(0, 50),
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
