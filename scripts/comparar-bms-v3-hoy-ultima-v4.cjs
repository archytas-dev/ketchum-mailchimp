const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
function conn(name) {
  const env = config.mcpServers?.[name]?.env;
  if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error(`Falta ${name}.`);
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}
async function execution(c, id) {
  const response = await fetch(`${c.base}/api/v1/executions/${id}?includeData=true`, { headers: c.headers });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  return response.json();
}
function clean(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function title(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function url(value) {
  try {
    const parsed = new URL(clean(value));
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|mc_|ref$)/i.test(key)) parsed.searchParams.delete(key);
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return parsed.toString();
  } catch { return clean(value).toLowerCase().replace(/\/$/, ''); }
}
function anchors(html) {
  const out = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const item = { url: url(match[1]), titulo: clean(match[2]) };
    if (!item.titulo || item.titulo.length < 12 || /unsubscribe|view this email|twitter|facebook|linkedin|ketchum/i.test(item.titulo)) continue;
    out.push(item);
  }
  return [...new Map(out.map((item) => [item.url + '|' + title(item.titulo), item])).values()];
}
function one(data, node) { return data?.[node]?.at(-1)?.data?.main?.[0]?.[0]?.json || {}; }

(async () => {
  const v3Id = process.argv[2] || '209769';
  const v4Id = process.argv[3] || '33476';
  const [v3, v4] = await Promise.all([execution(conn('archytas-n8n'), v3Id), execution(conn('ketchum-n8n'), v4Id)]);
  const oldHtml = String(one(v3.data?.resultData?.runData || {}, 'Build HTML Email').html || '');
  const newHtml = String(one(v4.data?.resultData?.runData || {}, 'Preparar email v3 de prueba').html || '');
  const oldNotes = anchors(oldHtml);
  const newNotes = anchors(newHtml);
  const oldByUrl = new Map(oldNotes.map((n) => [n.url, n]));
  const newByUrl = new Map(newNotes.map((n) => [n.url, n]));
  const oldByTitle = new Map(oldNotes.map((n) => [title(n.titulo), n]));
  const newByTitle = new Map(newNotes.map((n) => [title(n.titulo), n]));
  const commonUrl = [...newByUrl.keys()].filter((key) => oldByUrl.has(key));
  const commonTitle = [...newByTitle.keys()].filter((key) => oldByTitle.has(key));
  const v4Only = newNotes.filter((n) => !oldByUrl.has(n.url) && !oldByTitle.has(title(n.titulo)));
  const v3Only = oldNotes.filter((n) => !newByUrl.has(n.url) && !newByTitle.has(title(n.titulo)));
  console.log(JSON.stringify({
    v3: { ejecucion: v3Id, notas: oldNotes.length, html_bytes: oldHtml.length },
    v4: { ejecucion: v4Id, notas: newNotes.length, html_bytes: newHtml.length },
    coincidencias: { por_url: commonUrl.length, por_titulo: commonTitle.length },
    solo_v3_total: v3Only.length,
    solo_v4_total: v4Only.length,
    solo_v3: v3Only.slice(0, 30),
    solo_v4: v4Only.slice(0, 30),
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
