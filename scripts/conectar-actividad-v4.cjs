// Guarda el detalle de Actividad una vez que termina cada corrida del plano test.
// La rama prod pasa directo a Cierre: no llama ninguna RPC test ni toca v3.
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'ORrmePsGxJJxISTo';
const supabase = 'https://banlcbewinpjtudzdzhm.supabase.co/rest/v1';

async function request(path, options = {}) {
  let lastError;
  for (let intento = 1; intento <= 3; intento += 1) {
    try {
      const response = await fetch(`${base}${path}`, { headers, ...options });
      const body = await response.text();
      if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${body.slice(0, 800)}`);
      return body ? JSON.parse(body) : {};
    } catch (error) {
      lastError = error;
      if (intento < 3) await new Promise((resolve) => setTimeout(resolve, intento * 1000));
    }
  }
  throw lastError;
}

function find(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`No encontré el nodo ${name}.`);
  return node;
}

function replaceNode(workflow, node) {
  const index = workflow.nodes.findIndex((item) => item.name === node.name);
  if (index >= 0) workflow.nodes[index] = node;
  else workflow.nodes.push(node);
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const close = find(active, 'Cerrar corrida');
  find(active, 'Cierre');

  const gateName = '¿Guardar actividad v4 test?';
  const snapshotName = 'Guardar foto de Actividad v4';

  replaceNode(active, {
    name: gateName,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [close.position[0] + 260, close.position[1] - 90],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        combinator: 'and',
        conditions: [{
          leftValue: "={{ $('Config').first().json.modo }}",
          rightValue: 'test',
          operator: { type: 'string', operation: 'equals' },
        }],
      },
      options: {},
    },
  });

  replaceNode(active, {
    name: snapshotName,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [close.position[0] + 500, close.position[1] - 170],
    parameters: {
      method: 'POST',
      url: `${supabase}/rpc/v4_test_snapshot_actividad`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ p_run_id: $('Abrir corrida del día').first().json.run_id }) }}",
      options: { response: { response: { neverError: true } }, timeout: 60000 },
    },
  });

  active.connections['Cerrar corrida'] = { main: [[{ node: gateName, type: 'main', index: 0 }]] };
  active.connections[gateName] = {
    main: [
      [{ node: snapshotName, type: 'main', index: 0 }],
      [{ node: 'Cierre', type: 'main', index: 0 }],
    ],
  };
  active.connections[snapshotName] = { main: [[{ node: 'Cierre', type: 'main', index: 0 }]] };

  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes: active.nodes, connections: active.connections, settings: active.settings || workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });

  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const published = verified.activeVersion || verified;
  const publishedGate = find(published, gateName);
  const publishedSnapshot = find(published, snapshotName);
  const gateLinks = published.connections[gateName]?.main ?? [];
  const prodBypasses = gateLinks[1]?.some((link) => link.node === 'Cierre');
  const testSnapshots = gateLinks[0]?.some((link) => link.node === snapshotName)
    && String(publishedSnapshot.parameters.url).includes('/v4_test_snapshot_actividad');
  if (!prodBypasses || !testSnapshots || !String(publishedGate.parameters.conditions.conditions?.[0]?.leftValue).includes("modo")) {
    throw new Error('La publicación no dejó aislada la rama test de Actividad.');
  }
  console.log(JSON.stringify({ ok: true, workflow: verified.name, activeVersionId: verified.activeVersionId, prod: 'Cierre directo', test: 'snapshot de medios y keywords antes de Cierre' }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
