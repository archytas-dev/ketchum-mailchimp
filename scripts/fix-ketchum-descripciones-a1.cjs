// Recupera la descripcion desde el cuerpo ya extraido por open-article cuando
// la pagina no publica un og:description ni un copete editorial explicito.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta la conexion ketchum-n8n.');

const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'E5JLokzkBxeCyLzv';

async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

const oldBlock = `if (p.falta.copete && r.copete && r.copete.length >= 40) {
  if (!copeteCruzado(titulo, r.copete)) { snippet = r.copete; arreglos.push('copete_de_la_pagina'); }
  else arreglos.push('copete_de_la_pagina_descartado_por_cruzado');
}`;

const newBlock = `// [A1-RESCATE-DESCRIPCION]
// Algunas fuentes no exponen meta-description ni copete, pero open-article ya
// conserva un fragmento chico del cuerpo. Lo usamos como respaldo editorial,
// nunca como HTML crudo, y mantenemos la nota aun si no hubiera texto recuperable.
function copeteDeCuerpo(texto, tituloActual) {
  const limpio = String(texto || '')
    .replace(/\\s+/g, ' ').trim()
    .replace(/^(compartir|leer tambien|tambien te puede interesar)[:\\s-]*/i, '');
  if (limpio.length < 55) return null;
  const sinTitulo = tituloActual && limpio.toLowerCase().startsWith(String(tituloActual).toLowerCase())
    ? limpio.slice(String(tituloActual).length).replace(/^[\\s:.-]+/, '')
    : limpio;
  const corte = sinTitulo.match(/^(.{80,520}?[.!?])(?:\\s|$)/);
  const resultado = (corte ? corte[1] : sinTitulo.slice(0, 420)).trim();
  return resultado.length >= 55 ? resultado : null;
}
if (p.falta.copete) {
  const candidato = r.copete && r.copete.length >= 40 ? r.copete : copeteDeCuerpo(r.texto_contexto, titulo);
  const origenCopete = r.copete && r.copete.length >= 40 ? 'copete_de_la_pagina' : 'copete_rescatado_del_cuerpo';
  if (candidato) {
    if (!copeteCruzado(titulo, candidato)) { snippet = candidato; arreglos.push(origenCopete); }
    else arreglos.push(origenCopete + '_descartado_por_cruzado');
  } else {
    arreglos.push('copete_no_disponible_en_la_pagina');
  }
}`;

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const node = active.nodes.find((n) => n.name === 'Fusionar lo que trajo');
  if (!node) throw new Error('No existe el nodo Fusionar lo que trajo.');
  const before = String(node.parameters?.jsCode || '');
  if (before.includes('[A1-RESCATE-DESCRIPCION]')) throw new Error('El rescate de descripcion ya esta aplicado.');
  if (!before.includes(oldBlock)) throw new Error('El codigo de A1 cambio; no reemplazo a ciegas.');
  const after = before
    .replace(oldBlock, newBlock)
    .replace('sigue_incompleta: !titulo || titulo.length < 25', 'sigue_incompleta: !titulo || titulo.length < 25 || !snippet || snippet.length < 40');
  node.parameters.jsCode = after;

  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes: active.nodes, connections: active.connections || workflow.connections || {}, settings: active.settings || workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });

  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const code = String((verified.activeVersion || verified).nodes.find((n) => n.name === 'Fusionar lo que trajo')?.parameters?.jsCode || '');
  if (!code.includes('[A1-RESCATE-DESCRIPCION]') || !code.includes('copete_rescatado_del_cuerpo')) throw new Error('La version activa no contiene el rescate.');
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, descripcionRescate: 'cuerpo_de_la_pagina', conservaNotaSinDescripcion: true }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
