const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
async function get(id) {
  const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  return response.json();
}
function clean(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function normTitle(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function notes(execution) {
  const data = execution.data?.resultData?.runData || {};
  const node = data['Preparar email v3 de prueba'] || [];
  const html = String(node.at(-1)?.data?.main?.[0]?.[0]?.json?.html || '');
  const out = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const titulo = clean(match[2]);
    if (titulo.length < 12 || /unsubscribe|view this email|twitter|facebook|linkedin|ketchum/i.test(titulo)) continue;
    out.push({ url: match[1], titulo });
  }
  return [...new Map(out.map((n) => [normTitle(n.titulo), n])).values()];
}
(async () => {
  const oldId = process.argv[2] || '32580';
  const newId = process.argv[3] || '33476';
  const [oldExecution, newExecution] = await Promise.all([get(oldId), get(newId)]);
  const oldNotes = notes(oldExecution);
  const newNotes = notes(newExecution);
  const oldMap = new Map(oldNotes.map((n) => [normTitle(n.titulo), n]));
  const newMap = new Map(newNotes.map((n) => [normTitle(n.titulo), n]));
  const common = [...newMap.keys()].filter((key) => oldMap.has(key));
  console.log(JSON.stringify({
    anterior: { ejecucion: oldId, notas: oldNotes.length },
    nueva: { ejecucion: newId, notas: newNotes.length },
    comunes_por_titulo: common.length,
    solo_anterior: oldNotes.filter((n) => !newMap.has(normTitle(n.titulo))).slice(0, 40),
    solo_nueva: newNotes.filter((n) => !oldMap.has(normTitle(n.titulo))).slice(0, 40),
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
