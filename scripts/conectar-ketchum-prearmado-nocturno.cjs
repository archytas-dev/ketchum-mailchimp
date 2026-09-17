// Conecta el prearmado nocturno al workflow v4 de clipping.
// Alcance deliberado: solo modo test. No escribe ni envía por public/v3.
const fs = require('fs');

const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'))
  .mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta credencial de n8n Ketchum.');

const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'ORrmePsGxJJxISTo';

async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${body.slice(0, 800)}`);
  return body ? JSON.parse(body) : {};
}

const clients = [
  { key: 'Mars', id: '145311f2-79a0-430b-b528-c9683d1e196f' },
  { key: 'BMS', id: '99a7b1e3-2b24-4364-a055-be338bfff34a' },
  { key: 'Booking', id: '65170cb4-0646-4602-b5b5-f1b93e6762d4' },
  { key: 'MSD', id: '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026' },
];
// Cada ola empieza cuando ya terminó feeds + HTML + Google Alerts de esa
// ventana. Los clientes se escalonan para no concentrar A1/A2 en el worker.
const waves = [
  { label: 'pool 02:30', times: ['45 2 * * *', '0 3 * * *', '15 3 * * *', '30 3 * * *'], minutes: ['02:45', '03:00', '03:15', '03:30'] },
  { label: 'pool 05:30', times: ['45 5 * * *', '0 6 * * *', '15 6 * * *', '30 6 * * *'], minutes: ['05:45', '06:00', '06:15', '06:30'] },
];

function clientCode(clientId, fase) {
  return `return [{ json: { client_id: '${clientId}', modo: 'test', fase: '${fase}' } }];`;
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const nodes = [...(active.nodes || [])];
  const connections = structuredClone(active.connections || {});

  const config = nodes.find((node) => node.name === 'Config');
  const nextPage = nodes.find((node) => node.name === 'Disparar pagina siguiente');
  const emailGate = nodes.find((node) => node.name === '¿enviar email de prueba?');
  if (!config || !nextPage || !emailGate) throw new Error('El workflow activo no tiene los nodos base esperados.');
  if (!String(config.parameters?.jsCode || '').includes("['prearmar','cerrar','enviar']")) {
    throw new Error('Falta el guardrail de fases; no se publica un cron nocturno inseguro.');
  }

  // La reentrada por página es una nueva ejecución: debe conservar la fase y
  // cualquier límite manual para que prearmar nunca se transforme en cerrar.
  nextPage.parameters.jsonBody = "={{ JSON.stringify({ client_id: $('Config').first().json.client_id, fecha: $('Config').first().json.fecha, modo: $('Config').first().json.modo, fase: $('Config').first().json.fase, limite: $('Config').first().json.limite, rehacer: false, run_id: $('Abrir corrida del día').first().json.run_id }) }}";

  // Los crons de la mañana quedan explícitos: cierran, guardan y envían el
  // clipping test. No dependen de un default de Config.
  for (const client of clients) {
    const morning = nodes.find((node) => node.name === `Cliente ${client.key} (prueba interna)`);
    if (!morning) throw new Error(`Falta el nodo matinal de ${client.key}.`);
    morning.parameters.jsCode = clientCode(client.id, 'cerrar');
  }

  // Reemplazamos solo nuestros nodos para que el script sea idempotente.
  const isManagedPrearmado = (name) => /^Cron · prearmado |^Cliente .+ \(prearmado interno\)$/.test(String(name || ''));
  const generatedNames = new Set(nodes.filter((node) => isManagedPrearmado(node.name)).map((node) => node.name));
  const keptNodes = nodes.filter((node) => !isManagedPrearmado(node.name));
  for (const name of generatedNames) delete connections[name];
  for (const [source, outputs] of Object.entries(connections)) {
    // n8n representa las salidas como { main: [[...]] }, no como un array
    // directo. Conservamos cualquier salida no-main intacta.
    for (const [outputName, branches] of Object.entries(outputs || {})) {
      if (!Array.isArray(branches)) continue;
      connections[source][outputName] = branches.map((branch) =>
        Array.isArray(branch) ? branch.filter((link) => !isManagedPrearmado(link.node)) : branch
      );
    }
  }

  const cronTemplate = nodes.find((node) => node.type === 'n8n-nodes-base.scheduleTrigger');
  const codeTemplate = nodes.find((node) => node.name === 'Cliente Mars (prueba interna)');
  if (!cronTemplate || !codeTemplate) throw new Error('No hay plantilla de cron/cliente para crear el prearmado.');

  for (const [waveIndex, wave] of waves.entries()) {
    for (const [clientIndex, client] of clients.entries()) {
      const minute = wave.minutes[clientIndex];
      const cronName = `Cron · prearmado ${wave.label} · ${client.key} ${minute} ART`;
      const clientName = `Cliente ${client.key} (prearmado interno · ${wave.label})`;
      keptNodes.push({
        ...structuredClone(cronTemplate),
        id: `v4-prearmado-cron-${waveIndex}-${client.key.toLowerCase()}`,
        name: cronName,
        position: [-920 + waveIndex * 440, 560 + clientIndex * 160],
        parameters: { rule: { interval: [{ field: 'cronExpression', expression: wave.times[clientIndex] }] } },
      });
      keptNodes.push({
        ...structuredClone(codeTemplate),
        id: `v4-prearmado-client-${waveIndex}-${client.key.toLowerCase()}`,
        name: clientName,
        position: [-680 + waveIndex * 440, 560 + clientIndex * 160],
        parameters: { jsCode: clientCode(client.id, 'prearmar') },
      });
      connections[cronName] = { main: [[{ node: clientName, type: 'main', index: 0 }]] };
      connections[clientName] = { main: [[{ node: 'Config', type: 'main', index: 0 }]] };
    }
  }

  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: workflow.name,
      nodes: keptNodes,
      connections,
      settings: active.settings || workflow.settings || {},
    }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });

  const verifiedWorkflow = await request(`/api/v1/workflows/${workflowId}`);
  const verified = verifiedWorkflow.activeVersion || verifiedWorkflow;
  const byName = new Map((verified.nodes || []).map((node) => [node.name, node]));
  const reentry = byName.get('Disparar pagina siguiente');
  const verifiedGate = byName.get('¿enviar email de prueba?');
  if (!String(reentry?.parameters?.jsonBody || '').includes("fase: $('Config').first().json.fase")) {
    throw new Error('Publicó, pero la reentrada no conserva fase.');
  }
  const conditions = verifiedGate?.parameters?.conditions?.conditions || [];
  if (!conditions.some((condition) => condition.rightValue === 'prearmar' && condition.operator?.operation === 'notEquals')) {
    throw new Error('Publicó, pero el guardrail de no envío para prearmado no está activo.');
  }
  for (const wave of waves) {
    for (const [clientIndex, client] of clients.entries()) {
      const cronName = `Cron · prearmado ${wave.label} · ${client.key} ${wave.minutes[clientIndex]} ART`;
      const clientName = `Cliente ${client.key} (prearmado interno · ${wave.label})`;
      if (!byName.has(cronName) || !byName.has(clientName)) throw new Error(`Falta ${client.key} / ${wave.label} en la versión publicada.`);
      if (!String(byName.get(clientName).parameters?.jsCode || '').includes("fase: 'prearmar'")) {
        throw new Error(`${client.key} no quedó en fase prearmar para ${wave.label}.`);
      }
    }
  }
  for (const client of clients) {
    const morning = byName.get(`Cliente ${client.key} (prueba interna)`);
    if (!String(morning?.parameters?.jsCode || '').includes("fase: 'cerrar'")) {
      throw new Error(`${client.key} no quedó explícitamente en fase cerrar por la mañana.`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    workflow: verifiedWorkflow.name,
    active: verifiedWorkflow.active,
    activeVersionId: verifiedWorkflow.activeVersionId,
    prearmadoNocturno: waves.flatMap((wave) => clients.map((client, index) => ({ client: client.key, pool: wave.label, horaART: wave.minutes[index], cron: wave.times[index], modo: 'test', fase: 'prearmar' }))),
    manana: clients.map(({ key }) => ({ client: key, modo: 'test', fase: 'cerrar' })),
    garantias: [
      'cada reentrada conserva fase y limite',
      'prearmar no cruza la compuerta de guardar/enviar clipping',
      'solo usa modo test',
    ],
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
