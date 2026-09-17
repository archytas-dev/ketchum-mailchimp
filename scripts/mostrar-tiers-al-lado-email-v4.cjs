const fs = require('fs');

const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta conexion a n8n Ketchum.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

(async () => {
  const workflow = await request('/api/v1/workflows/ORrmePsGxJJxISTo');
  const prep = workflow.nodes.find((node) => node.name === 'Preparar email v3 de prueba');
  if (!prep?.parameters?.jsCode) throw new Error('No encontre el preparador de email de prueba.');

  const marker = "if (!__out.html || String(__out.html).length < 500) throw new Error('El template v3 no genero HTML valido para ' + __client.label + '.');";
  const inject = `${marker}

// Los datos se agregan buscando el href exacto de la nota. No se busca el
// nombre del medio en el HTML: puede aparecer dentro de la URL y romperla.
const __escapeHtmlMeta = (value) => String(value ?? '').replace(/[&<>\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[c]));
const __fmtNumeroMeta = (value) => String(Math.round(Number(value))).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
const __fmtValorMeta = (value) => '$ ' + __fmtNumeroMeta(value);
const __notasMeta = __clipping.secciones.flatMap(s => Array.isArray(s.notas) ? s.notas : []);
for (const __notaMeta of __notasMeta) {
  const __partesMeta = [];
  if (__notaMeta.alcance !== null && __notaMeta.alcance !== undefined && __notaMeta.alcance !== '' && Number.isFinite(Number(__notaMeta.alcance))) __partesMeta.push('Alcance: ' + __fmtNumeroMeta(__notaMeta.alcance));
  if (__notaMeta.tier !== null && __notaMeta.tier !== undefined && __notaMeta.tier !== '') __partesMeta.push('Tier: ' + __escapeHtmlMeta(String(__notaMeta.tier).replace(/^tier\\s*/i, '').trim()));
  if (__notaMeta.ad_value !== null && __notaMeta.ad_value !== undefined && __notaMeta.ad_value !== '' && Number.isFinite(Number(__notaMeta.ad_value))) __partesMeta.push('Ad Value: ' + __fmtValorMeta(__notaMeta.ad_value));
  if (!__partesMeta.length || !__notaMeta.url) continue;
  const __urlMeta = String(__notaMeta.url);
  let __posMeta = __out.html.indexOf('href="' + __urlMeta + '"');
  if (__posMeta < 0) __posMeta = __out.html.indexOf("href='" + __urlMeta + "'");
  if (__posMeta < 0) continue;
  const __anchorMeta = __out.html.lastIndexOf('<a', __posMeta);
  if (__anchorMeta < 0 || __out.html.slice(Math.max(0, __anchorMeta - 500), __anchorMeta).includes('data-v4-media-meta')) continue;
  const __metaHtml = ' <span data-v4-media-meta="1" style="color:#666;font-weight:normal">(' + __partesMeta.join(' ') + ')</span>';
  __out.html = __out.html.slice(0, __anchorMeta) + __metaHtml + __out.html.slice(__anchorMeta);
}`;

  let code = String(prep.parameters.jsCode);
  const oldArticleFields = "    ad_value: note.ad_value ?? null,\n";
  const newArticleFields = "    tier: note.tier ?? null,\n    alcance: note.alcance ?? null,\n    ad_value: note.ad_value ?? null,\n";
  if (code.includes(oldArticleFields) && !code.includes("    alcance: note.alcance ?? null,")) code = code.replace(oldArticleFields, newArticleFields);
  const start = code.indexOf(marker);
  const end = start >= 0 ? code.indexOf('return [{ json: {', start) : -1;
  if (start < 0 || end < 0) throw new Error('Cambio el final del template; no aplico un parche inseguro.');
  // Se usa slicing y no String.replace: $& dentro de JavaScript de destino se
  // interpretaría como el texto matcheado por el reemplazo y corrompería código.
  code = code.slice(0, start) + inject + code.slice(end);
  prep.parameters.jsCode = code;
  await request('/api/v1/workflows/' + workflow.id, { method: 'PUT', body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }) });
  await request('/api/v1/workflows/' + workflow.id + '/publish', { method: 'POST', body: '{}' });
  const updated = await request('/api/v1/workflows/' + workflow.id);
  console.log(JSON.stringify({ workflow: updated.id, activeVersionId: updated.activeVersionId, tier_visible: true }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
