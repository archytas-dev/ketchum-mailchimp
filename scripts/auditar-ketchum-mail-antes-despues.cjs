const fs = require('fs');

const [previousId = '37404', currentId = '38275'] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };

async function get(id) {
  const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
  if (!response.ok) throw new Error(`Ejecucion ${id}: HTTP ${response.status}`);
  return response.json();
}

function clean(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function norm(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function words(value) {
  return new Set(norm(value).split(' ').filter((word) => word.length > 4));
}

function possiblyCrossed(title, snippet) {
  const titleWords = words(title);
  const snippetWords = words(snippet);
  if (titleWords.size < 3 || snippetWords.size < 5) return false;
  let common = 0;
  for (const word of snippetWords) if (titleWords.has(word)) common++;
  return common === 0;
}

function clipping(execution) {
  const data = execution.data?.resultData?.runData || {};
  const node = data['Armar clipping para email de prueba'] || [];
  const json = node.at(-1)?.data?.main?.[0]?.[0]?.json || {};
  return (json.secciones || []).flatMap((section) => (section.notas || []).map((note) => ({
    seccion: section.nombre,
    medio: note.medio,
    titulo: note.titulo || note.title,
    snippet: note.snippet || note.descripcion || note.description || '',
    url: note.url,
    tier: note.tier,
    alcance: note.alcance,
    ad_value: note.ad_value,
  })));
}

function summarize(rows) {
  return {
    total: rows.length,
    sin_descripcion: rows.filter((row) => !clean(row.snippet)).map(({ seccion, medio, titulo, url }) => ({ seccion, medio, titulo, url })),
    posibles_cruzadas: rows.filter((row) => possiblyCrossed(row.titulo, row.snippet))
      .map(({ seccion, medio, titulo, snippet, url }) => ({ seccion, medio, titulo, descripcion: clean(snippet).slice(0, 220), url })),
    con_tier: rows.filter((row) => row.tier !== null && row.tier !== undefined && String(row.tier).trim() !== '').length,
    con_alcance: rows.filter((row) => row.alcance !== null && row.alcance !== undefined && String(row.alcance).trim() !== '').length,
    con_ad_value: rows.filter((row) => row.ad_value !== null && row.ad_value !== undefined && String(row.ad_value).trim() !== '').length,
  };
}

(async () => {
  const [previous, current] = await Promise.all([get(previousId), get(currentId)]);
  const before = clipping(previous);
  const after = clipping(current);
  const beforeByTitle = new Map(before.map((row) => [norm(row.titulo), row]));
  const afterByTitle = new Map(after.map((row) => [norm(row.titulo), row]));
  const common = [...afterByTitle.keys()].filter((key) => beforeByTitle.has(key));
  console.log(JSON.stringify({
    ejecuciones: { anterior: previousId, nueva: currentId },
    anterior: summarize(before),
    nueva: summarize(after),
    comparacion: {
      comunes_por_titulo: common.length,
      solo_anterior: before.filter((row) => !afterByTitle.has(norm(row.titulo))).map(({ seccion, medio, titulo, url }) => ({ seccion, medio, titulo, url })),
      solo_nueva: after.filter((row) => !beforeByTitle.has(norm(row.titulo))).map(({ seccion, medio, titulo, url }) => ({ seccion, medio, titulo, url })),
      cambios_de_descripcion_en_comunes: common.map((key) => ({
        titulo: afterByTitle.get(key).titulo,
        descripcion_anterior: clean(beforeByTitle.get(key).snippet).slice(0, 220),
        descripcion_nueva: clean(afterByTitle.get(key).snippet).slice(0, 220),
      })).filter((row) => row.descripcion_anterior !== row.descripcion_nueva),
    },
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
