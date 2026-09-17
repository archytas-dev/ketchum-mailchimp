const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const MAIN_ID = 'ORrmePsGxJJxISTo';
const SENDER_ID = '4K8k0C1ptXdSiSdB';
const V3 = {
  bms: { workflowId: 'bgabQ3ICjdex0ppC', clientId: '99a7b1e3-2b24-4364-a055-be338bfff34a', label: 'BMS', subject: 'Ketchum Argentina | Clipping BMS', sender: 'Ketchum Argentina | Clipping BMS' },
  booking: { workflowId: 'Km1e6ZWLYEl9hQRV', clientId: '65170cb4-0646-4602-b5b5-f1b93e6762d4', label: 'Booking', subject: 'Ketchum Argentina | Clipping Booking', sender: 'Ketchum Argentina | Clipping Booking' },
  mars: { workflowId: 'VwGjBYNQvi51ZhR7', clientId: '145311f2-79a0-430b-b528-c9683d1e196f', label: 'Mars', subject: 'Ketchum | Clipping Mars', sender: 'Ketchum | Clipping Mars' },
  msd: { workflowId: '19NPw3POuwTKdUsK', clientId: '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026', label: 'MSD Salud Animal', subject: 'Ketchum | Clipping MSD Salud Animal', sender: 'Ketchum | Clipping MSD Salud Animal' },
};

function conn(name) {
  const env = config.mcpServers?.[name]?.env;
  if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error(`Falta ${name}.`);
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' } };
}

async function request(connection, path, options = {}) {
  const response = await fetch(`${connection.base}${path}`, { headers: connection.headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function renameWorkflowNodes(workflow, names) {
  for (const node of workflow.nodes) if (names[node.name]) node.name = names[node.name];
  const connections = {};
  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    connections[names[source] || source] = JSON.parse(JSON.stringify(outputs));
  }
  for (const outputs of Object.values(connections)) {
    for (const branch of Object.values(outputs)) {
      for (const edges of branch) {
        for (const edge of edges) edge.node = names[edge.node] || edge.node;
      }
    }
  }
  workflow.connections = connections;
}

function templateWrapper(codes) {
  const wrapped = Object.entries(codes).map(([key, source]) => `
async function __render_${key}() {
  const $input = { first: () => ({ json: __templateInput }) };
  const $ = (name) => {
    const json = name === 'GSID'
      ? __templateConfig
      : name === 'Build Tier Lookup'
        ? { lookup: __tierLookup }
        : {};
    return { first: () => ({ json }), all: () => [] };
  };
${source}
}
`).join('\n');
  return `// Templates de email copiados de los cuatro Build HTML Email activos de la v3.
// Este paso solo se alcanza en modo=test; el subworkflow de envio fuerza Adrian.
const __respuesta = $json || {};
const __clipping = __respuesta.body || __respuesta;
const __cfg = $('Config').first().json || {};
const __clients = ${JSON.stringify(Object.fromEntries(Object.entries(V3).map(([key, value]) => [value.clientId, { key, label: value.label, subject: value.subject, sender: value.sender }])))};
const __client = __clients[__cfg.client_id];
if (!__client) throw new Error('Cliente sin template v3 de email: ' + String(__cfg.client_id || ''));
if (String(__cfg.modo || '').toLowerCase() !== 'test') throw new Error('El email v3 en v4 solo permite modo=test.');
if (!Array.isArray(__clipping.secciones)) throw new Error('armar_clipping no devolvio secciones.');

const __aliases = {
  bms: {
    'Notas Exclusivas': 'Productos BMS',
    'Noticias del Sector': 'Sector y Gestión',
    'Áreas Terapéuticas': 'Indicaciones y Áreas Terapéuticas',
  },
  booking: { 'Notas Exclusivas': 'Exclusiva', 'Noticias del Sector': 'Turismo' },
  mars: {},
  msd: {},
};
const __articles = __clipping.secciones.flatMap((section) => {
  const sectionName = String(section.nombre || section.seccion || section.titulo || 'Sin grupo');
  return (Array.isArray(section.notas) ? section.notas : []).map((note) => ({
    id: note.id || note.candidata_id || '',
    title: note.titulo || note.title || '',
    url: note.url || note.url_canonica || '',
    snippet: note.snippet || '',
    medio: note.medio || note.dominio || note.dominio_norm || '',
    dominio: note.dominio || note.dominio_norm || '',
    grupo: __aliases[__client.key]?.[sectionName] || note.grupo || note.seccion || sectionName,
    pubDate: note.fecha_pub || note.pub_date || note.fecha || '',
    ad_value: note.ad_value ?? null,
    etiqueta: note.etiqueta || '',
    categoria: note.categoria || '',
  }));
});
const __templateInput = { articles: __articles };
const __templateConfig = { destinatario: 'adrian@archytas.io', openai_api_key: '' };
const __tierLookup = {};
${wrapped}
const __renderers = { bms: __render_bms, booking: __render_booking, mars: __render_mars, msd: __render_msd };
const __built = await __renderers[__client.key].call(this);
const __out = Array.isArray(__built) ? (__built[0]?.json || {}) : (__built?.json || {});
if (!__out.html || String(__out.html).length < 500) throw new Error('El template v3 no genero HTML valido para ' + __client.label + '.');
return [{ json: {
  modo: 'test',
  para: 'adrian@archytas.io',
  destinatarios: 1,
  cliente: __client.label,
  asunto: __client.subject + ' — ' + (__out.fecha || __cfg.fecha || new Date().toLocaleDateString('es-AR')),
  nombre_remitente: __client.sender,
  html: __out.html,
  total_notas: Number(__out.total_notas || __articles.length),
  secciones: Number(__out.total_grupos || __clipping.secciones.length),
} }];`;
}

(async () => {
  const old = conn('archytas-n8n');
  const current = conn('ketchum-n8n');
  const entries = await Promise.all(Object.entries(V3).map(async ([key, spec]) => {
    const workflow = await request(old, `/api/v1/workflows/${spec.workflowId}`);
    const node = (workflow.nodes || []).find((item) => item.name === 'Build HTML Email' && item.type === 'n8n-nodes-base.code');
    if (!node?.parameters?.jsCode) throw new Error(`No encontre Build HTML Email en la v3 de ${key}.`);
    return [key, node.parameters.jsCode];
  }));
  const code = templateWrapper(Object.fromEntries(entries));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  new AsyncFunction(code);

  const main = await request(current, `/api/v1/workflows/${MAIN_ID}`);
  const names = {
    'Armar clipping BMS para email de prueba': 'Armar clipping para email de prueba',
    'Preparar email BMS de prueba': 'Preparar email v3 de prueba',
    'Enviar email BMS de prueba': 'Enviar email v3 de prueba',
  };
  renameWorkflowNodes(main, names);
  const prepare = main.nodes.find((node) => node.name === names['Preparar email BMS de prueba']);
  if (!prepare) throw new Error('No encontre el nodo Preparar email de prueba en v4.');
  prepare.parameters = { mode: 'runOnceForAllItems', jsCode: code };
  const mainSaved = await request(current, `/api/v1/workflows/${MAIN_ID}`, {
    method: 'PUT', body: JSON.stringify({ name: main.name, nodes: main.nodes, connections: main.connections, settings: main.settings || {} }),
  });
  await request(current, `/api/v1/workflows/${MAIN_ID}/publish`, { method: 'POST', body: '{}' });

  const sender = await request(current, `/api/v1/workflows/${SENDER_ID}`);
  const guard = sender.nodes.find((node) => node.type === 'n8n-nodes-base.code' && /BLOQUEADO|modo=test|modo/.test(node.parameters?.jsCode || ''));
  const gmail = sender.nodes.find((node) => node.type === 'n8n-nodes-base.gmail');
  if (!guard || !gmail) throw new Error('No encontre la guarda o Gmail en el subworkflow de envio.');
  guard.parameters.jsCode = `const input = $json || {};
if (String(input.modo || '').toLowerCase() !== 'test') throw new Error('BLOQUEADO: el envio v4 solo esta habilitado en modo=test.');
if (!input.html || String(input.html).length < 500) throw new Error('BLOQUEADO: HTML de email incompleto.');
return { json: { ...input, para: 'adrian@archytas.io', destinatarios: 1 } };`;
  gmail.disabled = false;
  gmail.parameters = {
    sendTo: '={{ $json.para }}',
    subject: '={{ $json.asunto }}',
    message: '={{ $json.html }}',
    options: { appendAttribution: false, senderName: '={{ $json.nombre_remitente }}' },
  };
  await request(current, `/api/v1/workflows/${SENDER_ID}`, {
    method: 'PUT', body: JSON.stringify({ name: sender.name, nodes: sender.nodes, connections: sender.connections, settings: sender.settings || {} }),
  });
  await request(current, `/api/v1/workflows/${SENDER_ID}/publish`, { method: 'POST', body: '{}' });

  const verifiedMain = await request(current, `/api/v1/workflows/${MAIN_ID}`);
  const activePrepare = verifiedMain.activeVersion?.nodes?.find((node) => node.name === names['Preparar email BMS de prueba']);
  const verifiedSender = await request(current, `/api/v1/workflows/${SENDER_ID}`);
  const activeGuard = verifiedSender.activeVersion?.nodes?.find((node) => node.type === 'n8n-nodes-base.code' && /solo esta habilitado en modo=test/.test(node.parameters?.jsCode || ''));
  const activeGmail = verifiedSender.activeVersion?.nodes?.find((node) => node.type === 'n8n-nodes-base.gmail');
  if (!activePrepare || !/Templates de email copiados/.test(activePrepare.parameters?.jsCode || '')) throw new Error('El template no quedo publicado en la v4.');
  if (!activeGuard || activeGmail?.parameters?.sendTo !== '={{ $json.para }}') throw new Error('El envio seguro no quedo publicado.');
  console.log(JSON.stringify({
    main: { id: mainSaved.id, active_version: verifiedMain.activeVersionId, template_chars: activePrepare.parameters.jsCode.length },
    sender: { id: SENDER_ID, active_version: verifiedSender.activeVersionId, test_only: true, forced_recipient: 'adrian@archytas.io' },
    imported_templates: Object.keys(V3),
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
