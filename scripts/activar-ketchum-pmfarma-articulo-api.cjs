// PMFarma sirve las notas como SPA. Conservamos el enlace visible de pmfarma.com
// pero fetch-page pide su API pública y open-article extrae el JSON directamente.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}
function node(w, name) { const n = (w.nodes || []).find(x => x.name === name); if (!n) throw new Error(`${w.name}: falta ${name}.`); return n; }
function body(w) { return { name:w.name, nodes:w.nodes, connections:w.connections, settings:w.settings || {} }; }
(async () => {
  const fetchPage = await request('/api/v1/workflows/kwyBxom1AVrwQJ8m');
  const fActive = fetchPage.activeVersion || fetchPage;
  const http = node(fActive, 'HTTP directo');
  const norm = node(fActive, 'Normalizar → contrato de pagina');
  const oldNorm = String(norm.parameters.jsCode || '');
  if (!oldNorm.includes("if (!/<a\\s[^>]*href/i.test(body))")) throw new Error('fetch-page cambió: no parcheo a ciegas.');
  http.parameters.url = "={{ $json.dominio_norm === 'pmfarma.com' ? 'https://api.pmfarma.com/api/noticias/' + (($json.url.match(/\\/noticias\\/(\\d+)/) || [])[1] || '') : $json.url }}";
  if (!oldNorm.includes('[PMFARMA-API-ARTICLE]')) {
    norm.parameters.jsCode = oldNorm.replace(
      'r.bytes = body.length;',
      `// [PMFARMA-API-ARTICLE] La API devuelve JSON, no enlaces HTML.\nif (req.dominio_norm === 'pmfarma.com' && String(body || '').trimStart().startsWith('{')) {\n  try {\n    const j = JSON.parse(body);\n    if (j && j.noticia) { r.bytes = body.length; r.html = body; r.diagnostico = 'ok'; return { json: r }; }\n  } catch (e) {}\n}\n\nr.bytes = body.length;`
    );
  }

  const article = await request('/api/v1/workflows/mnofS4TurFRTVRsh');
  const aActive = article.activeVersion || article;
  const extract = node(aActive, 'Extraer la nota');
  const oldExtract = String(extract.parameters.jsCode || '');
  if (!oldExtract.includes('const html = r.html;')) throw new Error('open-article cambió: no parcheo a ciegas.');
  if (!oldExtract.includes('[PMFARMA-API-ARTICLE]')) {
    extract.parameters.jsCode = oldExtract.replace(
      'const html = r.html;',
      `// [PMFARMA-API-ARTICLE] La URL pública es una SPA; fetch-page entrega su JSON.\n  if (r.dominio_norm === 'pmfarma.com' && String(r.html || '').trimStart().startsWith('{')) {\n    try {\n      const p = JSON.parse(r.html);\n      if (p && p.noticia) {\n        const tituloApi = limpiar(p.titulo);\n        const cuerpoApi = limpiar(p.contenido);\n        const copeteApi = limpiar(p.entradilla) || (cuerpoApi.length >= 55 ? cuerpoApi.slice(0, 520) : null);\n        const fechaApi = aIso(p.fecha_no_format || p.fecha);\n        return { json: { ...base, ok: !!(tituloApi && tituloApi.length >= 15),\n          diagnostico: tituloApi && tituloApi.length >= 15 ? 'ok' : 'sin_titulo',\n          titulo: tituloApi || null, copete: copeteApi || null, fecha_pub: fechaApi,\n          fecha_origen: fechaApi ? 'api_pmfarma' : null, texto_contexto: cuerpoApi.slice(0, 2400) || null } };\n      }\n    } catch (e) {}\n  }\n\n  const html = r.html;`
    );
  }
  for (const w of [fetchPage, article]) {
    const active = w.activeVersion || w;
    await request('/api/v1/workflows/' + w.id, { method:'PUT', body:JSON.stringify({ ...body(active), name: w.name }) });
    await request('/api/v1/workflows/' + w.id + '/publish', { method:'POST', body:'{}' });
  }
  console.log(JSON.stringify({ ok:true, workflows:['fetch-page','open-article'], fuente:'PMFarma API directa' }, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
