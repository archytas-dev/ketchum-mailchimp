// Mars: la macroeconomia no es agenda suficiente por si sola. Requiere una
// segunda senal concreta de marca, competencia o categoria Mars.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta la conexion ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = '9pwrSH2KdpGhbXjS';
const marker = '// [MARS-ECONOMIA-DOS-LLAVES]';
async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}
const gate = String.raw`
  ${marker}
  if (p.client_id === '145311f2-79a0-430b-b528-c9683d1e196f' && entra) {
    const tituloEconomia = sinAcentos(n.titulo);
    const textoEconomia = sinAcentos([n.titulo, n.snippet, n.texto_contexto].filter(Boolean).join(' '));
    const macroEnTitulo = /\b(inflacion|dolar|presupuesto|salario|empleo|desempleo|consumo|pbi|actividad economica|tasas|reservas|bcra|banco central|mercado financiero|riesgo pais|impuesto|retenciones|exportacion|importacion)\b/.test(tituloEconomia);
    const senalCategoria = /\b(mars|pedigree|whiskas|wrigley|m\s*&\s*m|snickers|twix|orbit|dentastix|skittles|starburst|purina|royal canin|hill'?s|pro plan|dog chow|cat chow|arcor|georgalos|felfort|mondelez|cadbury|vitalcan|nutrique|sieger|golocan|iams|eukanuba|ferrero|dogui|gati|old prince|kongo|fawna|petfood|alimento balanceado|nutricion (animal|canina|felina)|veterinari|mascota|mascotas|perro|perros|gato|gatos|golosina|golosinas|confiteria|chocolate|chocolates|alfajor|alfajores|chicle|chicles|caramelo|caramelos|snack|snacks|retail de alimentos|consumo masivo)\b/.test(textoEconomia);
    const keywordsGenericas = /^(inflacion|dolar|presupuesto|salario|empleo|consumo|economia|actividad economica|mercado|argentina)$/;
    const keywordEspecifica = String(n.keyword_match || '').split(/[|,;/]/)
      .map(x => sinAcentos(x).trim()).some(x => x.length >= 4 && !keywordsGenericas.test(x));
    if (macroEnTitulo && !senalCategoria && !keywordEspecifica) {
      entra = false;
      forzada = true;
      motivo = (motivo ? motivo + '; ' : '') + 'Mars: economia general sin segunda senal de marca, competencia o categoria';
    }
  }
`;
(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const node = active.nodes.find(n => n.name === 'Aplicar el veredicto');
  if (!node) throw new Error('No existe Aplicar el veredicto.');
  const before = String(node.parameters?.jsCode || '');
  if (before.includes(marker)) throw new Error('La regla de dos llaves ya esta activa.');
  const anchor = "  if (entra === false && !motivo) motivo = 'A2 descartó la nota sin devolver motivo';";
  if (!before.includes(anchor)) throw new Error('El contrato de A2 cambio; no edito a ciegas.');
  node.parameters.jsCode = before.replace(anchor, gate + '\n' + anchor);
  await request(`/api/v1/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify({ name: workflow.name, nodes: active.nodes, connections: active.connections || workflow.connections || {}, settings: active.settings || workflow.settings || {} }) });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const code = String((verified.activeVersion || verified).nodes.find(n => n.name === 'Aplicar el veredicto')?.parameters?.jsCode || '');
  if (!code.includes(marker)) throw new Error('La regla no quedo activa.');
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, marsEconomia: 'dos_llaves' }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
