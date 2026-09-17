const fs = require('fs');
const crypto = require('crypto');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');

const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'WfKUwnGWabKVMFo9';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : null;
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const nodes = workflow.nodes || [];
  const extract = nodes.find((node) => node.name === 'Extraer y desenvolver');
  const fetchLog = nodes.find((node) => node.name === 'Escribir fetch_log (bulk)');
  const summary = nodes.find((node) => node.name === 'Resumen');
  if (!extract || !fetchLog || !summary) throw new Error('Falta un nodo esperado; no se modifica el workflow.');

  let guard = nodes.find((node) => node.name === '¿modo=prod? (fetch_log)');
  if (!guard) {
    const existingIf = nodes.find((node) => node.name === '¿modo=prod y hay notas?');
    if (!existingIf) throw new Error('No existe un IF para clonar; no publico a ciegas.');
    guard = JSON.parse(JSON.stringify(existingIf));
    guard.id = crypto.randomUUID();
    guard.name = '¿modo=prod? (fetch_log)';
    guard.position = [extract.position?.[0] + 220 || 820, extract.position?.[1] || 460];
    guard.parameters = {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{
          id: 'prod-only',
          leftValue: "={{ $('Extraer y desenvolver').first().json.modo }}",
          rightValue: 'prod',
          operator: { type: 'string', operation: 'equals' },
        }],
      },
      options: {},
    };
    nodes.push(guard);
  }

  const connections = workflow.connections || {};
  if (!connections['Extraer y desenvolver']) throw new Error('No existe la conexión de extracción.');
  connections['Extraer y desenvolver'].main = [[{ node: guard.name, type: 'main', index: 0 }]];
  connections[guard.name] = {
    main: [
      [{ node: fetchLog.name, type: 'main', index: 0 }],
      [{ node: summary.name, type: 'main', index: 0 }],
    ],
  };

  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes, connections, settings: workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });

  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const active = verified.activeVersion || verified;
  const activeGuard = active.nodes.find((node) => node.name === guard.name);
  const activeExtractConnection = active.connections?.['Extraer y desenvolver']?.main?.[0]?.[0]?.node;
  const activeGuardConnections = active.connections?.[guard.name]?.main || [];
  if (!activeGuard || activeExtractConnection !== guard.name) throw new Error('La versión activa no dejó el guard conectado.');
  if (activeGuardConnections[0]?.[0]?.node !== fetchLog.name || activeGuardConnections[1]?.[0]?.node !== summary.name) {
    throw new Error('La versión activa no dejó las dos ramas esperadas.');
  }

  console.log(JSON.stringify({
    workflow: verified.name,
    activeVersionId: verified.activeVersionId,
    testWritesFetchLog: false,
    prodWritesFetchLog: true,
    guard: guard.name,
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
