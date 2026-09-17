// Refuerza en código las reglas editoriales de Mars que ya existen en el prompt v3.
// El modelo sigue decidiendo sección; esta compuerta evita que "Noticias de interés"
// se convierta en un cajón de sastre cuando el modelo aprueba una nota sin evidencia.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = '9pwrSH2KdpGhbXjS';

async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

const marker = '// [MARS-CRITERIOS-V3]';
const gate = String.raw`
  ${marker}
  // Mars replica el alcance editorial de la v3: las notas de interés necesitan una
  // señal POSITIVA de agenda. No alcanza con ser argentina, venir de un medio seguido
  // o no haber caído en otra sección.
  if (p.client_id === '145311f2-79a0-430b-b528-c9683d1e196f' && entra) {
    const textoMars = sinAcentos([n.titulo, n.snippet, n.texto_contexto].filter(Boolean).join(' '));
    const tituloMars = sinAcentos(n.titulo);
    const esRuidoMars = /\b(futbol|futbolista|partido|gol|campeonato|liga|seleccion|tenis|boxeo|policial|asesin|robo|detenid|crimen|accidente fatal|horoscopo|quiniela|farandula|chimento|actriz|actor|cantante|serie|pelicula|streaming|turismo|hotel|viaje|receta|inmueble|obra de teatro)\b/.test(textoMars)
      || /\bbruno\s+mars\b|\bplaneta\s+marte\b|\bvmas\b/.test(textoMars);
    const marcaOCompetenciaMars = /\b(mars|pedigree|whiskas|wrigley|m\s*&\s*m|snickers|twix|orbit|dentastix|skittles|starburst|doublemint|spearmint|kellanova|waltham|purina|royal canin|hill'?s|pro plan|dog chow|cat chow|arcor|georgalos|felfort|mondelez|cadbury|vitalcan|nutrique|sieger|golocan|iams|eukanuba|ferrero|dogui|gati|old prince|kongo|fawna)\b/.test(textoMars);
    const mascotasMars = /\b(mascota|mascotas|perro|perros|gato|gatos|canin|felin|petfood|alimento balanceado|nutricion animal|veterinari|tenencia responsable|adopcion|castracion|esterilizacion|antirrab|zoonosis)\b/.test(textoMars);
    const snackingMars = /\b(golosina|golosinas|confiteria|chocolate|chocolates|alfajor|alfajores|chicle|chicles|caramelo|caramelos|snack|snacks)\b/.test(textoMars);
    const economiaMars = /\b(dolar|inflacion|riesgo pais|reservas|bcra|banco central|retencion|retenciones|impuesto|impuestos|salario|salarios|empleo|consumo|pbi|actividad economica|comercio exterior|exportacion|importacion|mercado financiero)\b/.test(textoMars);
    const argentinaMars = /\b(argentina|argentino|buenos aires|caba|bcra|indec|peso argentino|milei|caputo)\b/.test(textoMars);
    const evidenciaMars = marcaOCompetenciaMars || mascotasMars || snackingMars || (economiaMars && argentinaMars);
    if (esRuidoMars || !evidenciaMars) {
      entra = false;
      forzada = true;
      motivo = (motivo ? motivo + '; ' : '') + (esRuidoMars
        ? 'Mars: tema fuera de agenda editorial (deportes, policiales, espectáculos u ocio)'
        : 'Mars: sin señal concreta de marca, competencia, mascotas, confitería o coyuntura económica argentina');
    }
  }
`;

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const node = workflow.nodes.find((n) => n.name === 'Aplicar el veredicto');
  if (!node) throw new Error('No encontré el nodo Aplicar el veredicto.');
  const before = String(node.parameters?.jsCode || '');
  if (before.includes(marker)) throw new Error('La compuerta Mars ya está aplicada; no publico una segunda vez.');
  const needle = "  if (entra === false && !motivo) motivo = 'A2 descartó la nota sin devolver motivo';";
  if (!before.includes(needle)) throw new Error('El contrato de A2 cambió; no aplico una edición a ciegas.');
  node.parameters.jsCode = before.replace(needle, gate + '\n' + needle);

  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });

  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const active = verified.activeVersion || verified;
  const activeCode = String(active.nodes.find((n) => n.name === 'Aplicar el veredicto')?.parameters?.jsCode || '');
  if (!activeCode.includes(marker)) throw new Error('La versión activa no contiene la compuerta Mars.');
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, marsCriteriaGate: true }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
