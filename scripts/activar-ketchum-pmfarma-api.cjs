// PMFarma es una SPA: el HTML no tiene noticias. Publica un JSON estable en
// api.pmfarma.com; este parche agrega su parser al recolector de feeds y a la
// pieza fetch-source, sin alterar v3 ni los otros formatos.
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const ids = ['UUIlvhTv3Rjy9YEP', 'tzcHSIUdMGXVRFIo'];

async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 800)}`);
  return body ? JSON.parse(body) : {};
}
function node(w, name) {
  const n = (w.nodes || []).find(x => x.name === name);
  if (!n) throw new Error(`${w.name}: falta ${name}.`);
  return n;
}
function publishBody(w) {
  // La API de n8n rechaza meta/staticData/pinData al hacer PUT: son de lectura.
  return { name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} };
}
function apiHelper() {
  return `
function parsePmfarmApi(raw) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return []; }
  const rows = Array.isArray(data?.noticias) ? data.noticias : [];
  const slug = s => String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);
  const fecha = s => {
    const m = String(s || '').toLowerCase().match(/(\\d{1,2})\\s+([a-záéíóúñ]+)\\s+(\\d{4})/i);
    if (!m) return null;
    const meses = { enero:0, febrero:1, marzo:2, abril:3, mayo:4, junio:5, julio:6, agosto:7, septiembre:8, setiembre:8, octubre:9, noviembre:10, diciembre:11 };
    const mes = meses[m[2].normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')];
    if (mes === undefined) return null;
    return new Date(Date.UTC(+m[3], mes, +m[1], 12, 0, 0)).toISOString();
  };
  return rows.filter(x => x && x.noticia).map(x => ({
    titulo: x.titulo || null,
    // La URL visible sigue siendo pmfarma.com; A1 usa el id para completar por API.
    url: 'https://www.pmfarma.com/app/noticias/' + x.noticia + '-' + slug(x.titulo),
    fecha: fecha(x.fecha),
    snippet: null,
    pmfarma_id: String(x.noticia)
  }));
}
`;
}

(async () => {
  const [piece, collector] = await Promise.all(ids.map(id => request('/api/v1/workflows/' + id)));
  const pNode = node(piece, 'Normalizar → contrato');
  const pOld = String(pNode.parameters.jsCode || '');
  if (!pOld.includes('function parseFeed')) throw new Error('fetch-source cambió: no aplico parche inseguro.');
  if (!pOld.includes('function parsePmfarmApi')) {
    let code = pOld.replace('function parseFeed(xml){', apiHelper() + '\nfunction parseFeed(xml){');
    code = code.replace('r.items = parseFeed(body);', "r.items = req.formato === 'api_pmfarma' ? parsePmfarmApi(raw) : parseFeed(body);");
    pNode.parameters.jsCode = code;
  }

  const cNode = node(collector, 'Normalizar → notas');
  const cOld = String(cNode.parameters.jsCode || '');
  if (!cOld.includes('function parseFeed(xml)')) throw new Error('recolector cambió: no aplico parche inseguro.');
  if (!cOld.includes('function parsePmfarmApi')) {
    let code = cOld.replace('function parseFeed(xml) {', apiHelper() + '\nfunction parseFeed(xml) {');
    code = code.replace('items = parseFeed(body);\n      diag  = items.length ? \'ok\' : diagDirecto(status, body);', "items = q.formato === 'api_pmfarma' ? parsePmfarmApi(body) : parseFeed(body);\n      diag  = items.length ? 'ok' : (q.formato === 'api_pmfarma' ? 'sin_items' : diagDirecto(status, body));");
    // La tabla de candidatas no necesita conocer el id interno de PMFarma:
    // queda contenido en la URL visible y así no alteramos el contrato del pool.
    cNode.parameters.jsCode = code;
  }
  const out = [];
  for (const workflow of [piece, collector]) {
    await request('/api/v1/workflows/' + workflow.id, { method: 'PUT', body: JSON.stringify(publishBody(workflow)) });
    const pub = await request('/api/v1/workflows/' + workflow.id + '/publish', { method: 'POST', body: '{}' });
    out.push({ id: workflow.id, name: workflow.name, version: pub.id || pub.versionId || null });
  }
  console.log(JSON.stringify({ published: out, parser: 'api_pmfarma', transporte: 'directo' }, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
