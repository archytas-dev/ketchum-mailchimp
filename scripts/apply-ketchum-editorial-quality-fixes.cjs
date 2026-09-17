// Refuerza calidad editorial v4 en dos capas: instrucciones explicitas al juez
// y reglas finales por cliente. Tambien recupera descripciones de JSON-LD.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta la conexion ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${text.slice(0, 900)}`);
  return text ? JSON.parse(text) : {};
}
async function publish(workflowId, mutate, verify) {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  mutate(active.nodes);
  await request(`/api/v1/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify({ name: workflow.name, nodes: active.nodes, connections: active.connections || workflow.connections || {}, settings: active.settings || workflow.settings || {} }) });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const checked = await request(`/api/v1/workflows/${workflowId}`);
  verify(checked.activeVersion || checked);
  return { name: checked.name, activeVersionId: checked.activeVersionId };
}
function node(nodes, name) { const found = nodes.find(n => n.name === name); if (!found) throw new Error(`Falta el nodo ${name}`); return found; }

const qualityMarker = '// [REGLAS-EDITORIALES-V4-20260916]';
const qualityPrompt = String.raw`
const reglasEditorialesCliente = {
  '145311f2-79a0-430b-b528-c9683d1e196f': 'MARS — DESCARTAR política partidaria o institucional, reuniones de gabinete, elecciones, Malvinas, policiales, espectáculos y anécdotas de animales. Una nota económica sólo entra si su título trata directamente de inflación, dólar, consumo, empleo, salarios, actividad o un indicador económico argentino. Mascotas sólo entra si trata nutrición, salud, bienestar, industria o mercado del sector; no rescates, peregrinaciones ni historias individuales.',
  '65170cb4-0646-4602-b5b5-f1b93e6762d4': 'BOOKING — DESCARTAR policiales, accidentes, resultados deportivos y deporte sin negocio turístico, aunque mencionen una ciudad o viaje. Conservar turismo, hotelería, conectividad, vuelos, agencias, alojamientos, regulación o impacto comercial concreto. Si la nota está centrada en otro país sin efecto argentino, descartar.',
  '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026': 'MSD — DESCARTAR historias anecdóticas de mascotas, rescates, peregrinaciones o animales perdidos. Conservar salud animal, veterinaria, zoonosis, prevención, producción pecuaria, avicultura, porcinos, ganadería, innovación o marcas/competencia. Descartar una nota extranjera sin vínculo argentino o sectorial concreto.',
  '99a7b1e3-2b24-4364-a055-be338bfff34a': 'BMS — Priorizar salud, innovación, acceso, regulación, investigación y el sector farmacéutico. Descartar cursos, campañas locales o hechos aislados que no aporten una señal sanitaria, científica, regulatoria o sectorial.'
}[req.client_id] || '';
`;
const qualityGuard = String.raw`
  ${qualityMarker}
  // El prompt lo pide, pero esta segunda capa evita que una palabra perdida en
  // el cuerpo haga pasar ruido editorial.
  if (entra) {
    const textoEditorial = sinAcentos([n.titulo, n.snippet, n.texto_contexto].filter(Boolean).join(' '));
    const tituloEditorial = sinAcentos(n.titulo);
    let fueraEditorial = false;
    let motivoEditorial = '';
    if (p.client_id === '65170cb4-0646-4602-b5b5-f1b93e6762d4') {
      const policialODeporte = /\b(policial|robo|asesin|conden|choque|accidente|turismo carretera|futbol|futbolista|campeonato|liga|nfl|nba|formula 1|\bf1\b)\b/.test(tituloEditorial);
      const negocioTuristico = /\b(hotel|alojamiento|turismo|viaje|vuelo|aerolinea|aeropuerto|pasajer|crucero|agencia|conectividad|booking|hospitality)\b/.test(tituloEditorial);
      if (policialODeporte && !negocioTuristico) { fueraEditorial = true; motivoEditorial = 'Booking: policial o deporte sin impacto turistico concreto'; }
    }
    if (p.client_id === '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026') {
      const anecdotaMascota = /\b(perr[oa]s? peregrin|perro perdido|gato perdido|mascota rescatad[ao]|perro cayo|gato cayo|animal suelto|encuentro de golden|golden retriever)\b/.test(textoEditorial);
      if (anecdotaMascota) { fueraEditorial = true; motivoEditorial = 'MSD: anecdota de mascota sin agenda de salud animal o sector'; }
    }
    if (p.client_id === '145311f2-79a0-430b-b528-c9683d1e196f') {
      const politicaTitulo = /\b(gabinete|elecciones|autoridad de mesa|legisladores|congreso|malvinas|campana electoral|intendente|concejo deliberante)\b/.test(tituloEditorial);
      const economiaTitulo = /\b(inflacion|dolar|salario|empleo|consumo|pbi|actividad economica|tasas|reservas|banco central|bcra|mercado financiero|presupuesto)\b/.test(tituloEditorial);
      const mascotaAnecdota = /\b(perr[oa]s? peregrin|perro perdido|gato perdido|mascota rescatad[ao]|perro cayo|gato cayo|animal suelto|encuentro de golden|golden retriever)\b/.test(textoEditorial);
      const espectaculo = /\b(farandula|chimento|actriz|actor|cantante|obra de teatro|serie|pelicula|jonatan viale)\b/.test(tituloEditorial);
      if ((politicaTitulo && !economiaTitulo) || mascotaAnecdota || espectaculo) { fueraEditorial = true; motivoEditorial = 'Mars: politica, espectaculo o anecdota de mascotas fuera de agenda'; }
    }
    if (fueraEditorial) { entra = false; forzada = true; motivo = (motivo ? motivo + '; ' : '') + motivoEditorial; }
  }
`;

(async () => {
  const open = await publish('mnofS4TurFRTVRsh', (nodes) => {
    const n = node(nodes, 'Extraer la nota');
    const before = String(n.parameters?.jsCode || '');
    if (before.includes('[OPEN-ARTICLE-JSONLD-DESCRIPCION]')) return;
    const needle = 'function aIso(s) {';
    const helper = String.raw`// [OPEN-ARTICLE-JSONLD-DESCRIPCION]
function textoJsonLd(html) {
  const bloques = String(html || '').match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const bloque of bloques) {
    const crudo = String(bloque).replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      const dato = JSON.parse(crudo);
      const cola = Array.isArray(dato) ? [...dato] : [dato];
      while (cola.length) {
        const actual = cola.shift();
        if (!actual || typeof actual !== 'object') continue;
        if (Array.isArray(actual['@graph'])) cola.push(...actual['@graph']);
        const valor = actual.description || actual.articleBody || actual.abstract || null;
        const limpio = limpiar(valor);
        if (limpio.length >= 55) return limpio.slice(0, 520);
      }
    } catch (e) {}
  }
  return null;
}

`;
    if (!before.includes(needle)) throw new Error('Contrato open-article inesperado.');
    n.parameters.jsCode = before.replace(needle, helper + needle)
      .replace("const copete = meta(html, ['og:description','twitter:description','description'])", "const copete = meta(html, ['og:description','twitter:description','description'])\n    || textoJsonLd(html)");
  }, (active) => {
    if (!String(node(active.nodes, 'Extraer la nota').parameters.jsCode || '').includes('[OPEN-ARTICLE-JSONLD-DESCRIPCION]')) throw new Error('No quedo JSON-LD activo.');
  });

  const a2 = await publish('9pwrSH2KdpGhbXjS', (nodes) => {
    const prompt = node(nodes, 'Armar el pedido');
    const beforePrompt = String(prompt.parameters?.jsCode || '');
    if (!beforePrompt.includes('reglasEditorialesCliente')) {
      const anchor = "const articulos = notas.map((n, i) => ({";
      if (!beforePrompt.includes(anchor)) throw new Error('Contrato del prompt A2 inesperado.');
      prompt.parameters.jsCode = beforePrompt.replace(anchor, qualityPrompt + '\n' + anchor)
        .replace("+ '\\n\\nPAIS: ademÃ¡s del dominio, revisÃ¡ body_context.", "+ '\\n\\nFILTROS EDITORIALES DEL CLIENTE: ' + reglasEditorialesCliente + '\\n\\nPAIS: ademÃ¡s del dominio, revisÃ¡ body_context.");
    } else if (!beforePrompt.includes('FILTROS EDITORIALES DEL CLIENTE')) {
      const anchor = 'secciones, notas, user } }];';
      if (!beforePrompt.includes(anchor)) throw new Error('No encuentro el retorno del pedido de IA.');
      prompt.parameters.jsCode = beforePrompt.replace(anchor, "secciones, notas, user: user + '\\n\\nFILTROS EDITORIALES DEL CLIENTE: ' + reglasEditorialesCliente } }];");
    }
    const guard = node(nodes, 'Aplicar el veredicto');
    const beforeGuard = String(guard.parameters?.jsCode || '');
    if (!beforeGuard.includes(qualityMarker)) {
      const anchor = '  // [MARS-CRITERIOS-V3-V2]';
      if (!beforeGuard.includes(anchor)) throw new Error('Contrato de guarda A2 inesperado.');
      guard.parameters.jsCode = beforeGuard.replace(anchor, qualityGuard + '\n' + anchor);
    }
  }, (active) => {
    const p = String(node(active.nodes, 'Armar el pedido').parameters.jsCode || '');
    const g = String(node(active.nodes, 'Aplicar el veredicto').parameters.jsCode || '');
    if (!p.includes('reglasEditorialesCliente') || !p.includes('FILTROS EDITORIALES DEL CLIENTE') || !g.includes(qualityMarker)) throw new Error('No quedaron activas ambas capas editoriales.');
  });
  console.log(JSON.stringify({ ok: true, openArticle: open, a2: a2, cambios: ['descripcion JSON-LD', 'prompt IA por cliente', 'guarda editorial Booking/MSD/Mars'] }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
