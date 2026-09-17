// Segunda version de la compuerta Mars: conserva la amplitud de v3, pero evita
// que una mencion casual de mascotas o economia convierta ruido local en clipping.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta la conexion ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = '9pwrSH2KdpGhbXjS';
async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

const startMarker = '// [MARS-CRITERIOS-V3]';
const gate = String.raw`  // [MARS-CRITERIOS-V3-V2]
  // Replica el criterio amplio, pero no indiscriminado, de Noticias de interes v3.
  if (p.client_id === '145311f2-79a0-430b-b528-c9683d1e196f' && entra) {
    const textoMars = sinAcentos([n.titulo, n.snippet, n.texto_contexto].filter(Boolean).join(' '));
    const tituloMars = sinAcentos(n.titulo);
    const marcaOCompetencia = /\b(mars|pedigree|whiskas|wrigley|m\s*&\s*m|snickers|twix|orbit|dentastix|skittles|starburst|doublemint|spearmint|kellanova|waltham|purina|royal canin|hill'?s|pro plan|dog chow|cat chow|arcor|georgalos|felfort|mondelez|cadbury|vitalcan|nutrique|sieger|golocan|iams|eukanuba|ferrero|dogui|gati|old prince|kongo|fawna)\b/.test(textoMars);
    const ruidoDuro = /\b(futbol|futbolista|partido|gol|campeonato|liga|seleccion|tenis|boxeo|policial|asesin|robo|detenid|crimen|accidente fatal|horoscopo|quiniela|farandula|chimento|actriz|actor|cantante|serie|pelicula|streaming|obra de teatro|turismo|hotel|viaje|peregrin|receta|gorgojo|inmueble|corte de luz|epec)\b/.test(textoMars)
      || /\bbruno\s+mars\b|\bplaneta\s+marte\b|\bvmas\b/.test(textoMars);
    const mascotaSector = /\b(petfood|alimento balanceado|nutricion (animal|canina|felina)|industria (pet|mascot)|mercado (pet|mascot)|veterinari[ao]s?\b|aveaca|caena|zoonosis|antirrab|castracion|esterilizacion|tenencia responsable|bienestar animal|adopcion responsable)\b/.test(textoMars);
    const mascotaAnecdotica = /\b(perr[oa]s? peregrin|mascota rescatad[ao]|perro cayo|gato cayo|encuentro de golden|golden retriever|animal suelto|perro perdido)\b/.test(textoMars);
    const snackSector = /\b(golosina|golosinas|confiteria|chocolate|chocolates|alfajor|alfajores|chicle|chicles|caramelo|caramelos|snack|snacks)\b/.test(textoMars)
      && /\b(mercado|ventas|consumo|industria|camara|informe|relevamiento|indec|came|argentina|argentino)\b/.test(textoMars);
    const economiaNacional = /\b(dolar|inflacion|riesgo pais|reservas|bcra|banco central|retencion|retenciones|impuesto|impuestos|salario|salarios|empleo|consumo|pbi|actividad economica|comercio exterior|exportacion|importacion|mercado financiero|poder adquisitivo)\b/.test(textoMars)
      && /\b(argentina|argentino|buenos aires|caba|bcra|indec|peso argentino|came|uia|amcham|caputo)\b/.test(textoMars);
    const politicaSinAgenda = /\b(elecciones|autoridad de mesa|concejo deliberante|intendente|campana electoral|gabinete|legislatura)\b/.test(tituloMars)
      && !economiaNacional && !marcaOCompetencia && !mascotaSector && !snackSector;
    const evidencia = marcaOCompetencia || (mascotaSector && !mascotaAnecdotica) || snackSector || economiaNacional;
    if (ruidoDuro || politicaSinAgenda || !evidencia) {
      entra = false;
      forzada = true;
      motivo = (motivo ? motivo + '; ' : '') + (ruidoDuro || politicaSinAgenda
        ? 'Mars: tema fuera de agenda editorial'
        : 'Mars: sin senal concreta de marca, competencia, sector mascotas, snacking o economia argentina');
    }
  }
`;

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const node = active.nodes.find((n) => n.name === 'Aplicar el veredicto');
  if (!node) throw new Error('No existe el nodo Aplicar el veredicto.');
  const before = String(node.parameters?.jsCode || '');
  const start = before.indexOf(startMarker);
  const end = before.indexOf('\n  if (entra === false && !motivo)', start);
  if (start < 0 || end < 0) throw new Error('No encontre la compuerta Mars v1; no reemplazo a ciegas.');
  node.parameters.jsCode = before.slice(0, start) + gate + '\n' + before.slice(end);
  await request(`/api/v1/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify({ name: workflow.name, nodes: active.nodes, connections: active.connections || workflow.connections || {}, settings: active.settings || workflow.settings || {} }) });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const code = String((verified.activeVersion || verified).nodes.find((n) => n.name === 'Aplicar el veredicto')?.parameters?.jsCode || '');
  if (!code.includes('[MARS-CRITERIOS-V3-V2]')) throw new Error('La version activa no contiene Mars V2.');
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, marsGate: 'v2_criterio_v3_acotado', scope: 'solo Mars' }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
