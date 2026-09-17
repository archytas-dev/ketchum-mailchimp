const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
function conn(name) {
  const env = config.mcpServers?.[name]?.env;
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}
async function execution(c, id) {
  const response = await fetch(`${c.base}/api/v1/executions/${id}?includeData=true`, { headers: c.headers });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  return response.json();
}
function first(data, node) { return data?.[node]?.at(-1)?.data?.main?.[0]?.[0]?.json || {}; }
function decode(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function canon(value) {
  try {
    const url = new URL(decode(value));
    url.hash = ''; url.search = '';
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch { return null; }
}
function canonTitulo(value) {
  return decode(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function links(html) {
  const ignored = /(?:mcusercontent|mailchimp|cdn-images|ketchum\.com|twitter\.com|facebook\.com|google\.com\/maps|mailto:)/i;
  const seen = new Set();
  const out = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = canon(match[1]);
    const titulo = decode(match[2]);
    if (!url || ignored.test(url) || !titulo || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, titulo });
  }
  return out;
}
function metadataVisible(html) {
  const source = String(html || '');
  return {
    tier: (source.match(/Tier\s*:/gi) || []).length,
    alcance: (source.match(/Alcance\s*:/gi) || []).length,
    ad_value: (source.match(/Ad\.?\s*Value\s*:/gi) || []).length,
  };
}

const ids = {
  bms: { v3: '209769', v4: '30679' },
  booking: { v3: '209775', v4: '30719' },
  mars: { v3: '209766', v4: '30610' },
  msd: { v3: '209780', v4: '30750' },
};

(async () => {
  const v3 = conn('archytas-n8n');
  const v4 = conn('ketchum-n8n');
  const result = {};
  for (const [slug, pair] of Object.entries(ids)) {
    const [oldExecution, newExecution] = await Promise.all([execution(v3, pair.v3), execution(v4, pair.v4)]);
    const oldData = oldExecution.data?.resultData?.runData || {};
    const newData = newExecution.data?.resultData?.runData || {};
    const oldHtml = String(first(oldData, 'Build HTML Email').html || '');
    const newEmail = first(newData, 'Preparar email v3 de prueba') || first(newData, 'Guarda dura: modo') || {};
    const newHtml = String(newEmail.html || '');
    const oldLinks = links(oldHtml);
    const newLinks = links(newHtml);
    const oldSet = new Map(oldLinks.map((entry) => [entry.url, entry]));
    const newSet = new Map(newLinks.map((entry) => [entry.url, entry]));
    const comunes = [...newSet.keys()].filter((url) => oldSet.has(url));
    const oldTitles = new Map(oldLinks.map((entry) => [canonTitulo(entry.titulo), entry]));
    const newTitles = new Map(newLinks.map((entry) => [canonTitulo(entry.titulo), entry]));
    const titulosComunes = [...newTitles.keys()].filter((title) => oldTitles.has(title));
    result[slug] = {
      v3: { ejecucion: pair.v3, html: oldHtml.length, notas: oldLinks.length, metadata_visible: metadataVisible(oldHtml) },
      v4: { ejecucion: pair.v4, html: newHtml.length, notas: newLinks.length, metadata_visible: metadataVisible(newHtml) },
      comunes: comunes.length,
      titulos_comunes: titulosComunes.length,
      ejemplos_misma_nota_url_distinta: titulosComunes.slice(0, 10).map((title) => ({
        titulo: newTitles.get(title).titulo,
        v3: oldTitles.get(title).url,
        v4: newTitles.get(title).url,
      })),
      solo_v3: [...oldSet.values()].filter((entry) => !newSet.has(entry.url)).slice(0, 25),
      solo_v4: [...newSet.values()].filter((entry) => !oldSet.has(entry.url)).slice(0, 25),
    };
  }
  if (process.argv.includes('--resumen')) {
    for (const item of Object.values(result)) { delete item.solo_v3; delete item.solo_v4; }
  }
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
