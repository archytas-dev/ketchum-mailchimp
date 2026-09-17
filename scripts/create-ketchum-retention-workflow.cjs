// Deja un mantenimiento diario en n8n Ketchum para que el pool operativo no
// vuelva a crecer sin límite. El RPC hace el borrado por tandas y conserva el
// historial de notas enviadas.
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');

const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const name = 'v4 · mantenimiento · retención operativa';
const supabase = 'https://banlcbewinpjtudzdzhm.supabase.co/rest/v1/rpc/v4_purgar_datos_operativos';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 1200)}`);
  return body ? JSON.parse(body) : null;
}

async function list() {
  const response = await request('/api/v1/workflows?limit=250');
  return response.data || [];
}

function workflowPayload() {
  return {
    name,
    nodes: [
      {
        id: 'retencion-cron',
        name: 'Cron · 23:00 ART',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [0, 0],
        parameters: {
          rule: {
            interval: [{ field: 'cronExpression', expression: '0 23 * * *' }],
          },
        },
      },
      {
        id: 'retencion-rpc',
        name: 'Limpiar pool operativo',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [280, 0],
        parameters: {
          method: 'POST',
          url: supabase,
          authentication: 'predefinedCredentialType',
          nodeCredentialType: 'supabaseApi',
          sendBody: true,
          specifyBody: 'json',
          jsonBody: "={{ JSON.stringify({ p_antiguedad: '48 hours', p_max_rows: 100000, p_logs_antiguedad: '7 days' }) }}",
          options: {
            response: { response: { neverError: false } },
            timeout: 110000,
          },
        },
        credentials: {
          supabaseApi: { id: 'UnEitw6U4SIHjC6X', name: 'Ketchum - Supabase' },
        },
      },
    ],
    connections: {
      'Cron · 23:00 ART': {
        main: [[{ node: 'Limpiar pool operativo', type: 'main', index: 0 }]],
      },
    },
    settings: { executionOrder: 'v1' },
  };
}

(async () => {
  const existing = (await list()).find((item) => item.name === name);
  let workflow;
  if (existing) {
    workflow = await request(`/api/v1/workflows/${existing.id}`);
    await request(`/api/v1/workflows/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...workflowPayload(), name: workflow.name }),
    });
    workflow = await request(`/api/v1/workflows/${existing.id}`);
  } else {
    workflow = await request('/api/v1/workflows', {
      method: 'POST',
      body: JSON.stringify(workflowPayload()),
    });
  }

  await request(`/api/v1/workflows/${workflow.id}/publish`, { method: 'POST', body: '{}' });
  await request(`/api/v1/workflows/${workflow.id}/activate`, { method: 'POST', body: '{}' });

  const verified = await request(`/api/v1/workflows/${workflow.id}`);
  const active = verified.activeVersion || verified;
  const cron = (active.nodes || []).find((node) => node.name === 'Cron · 23:00 ART');
  const rpc = (active.nodes || []).find((node) => node.name === 'Limpiar pool operativo');
  if (!verified.active || !cron || !rpc) throw new Error('El workflow no quedó activo o incompleto.');

  console.log(JSON.stringify({
    id: verified.id,
    name: verified.name,
    active: verified.active,
    activeVersionId: verified.activeVersionId,
    schedule: cron.parameters.rule.interval[0].expression,
    rpc: rpc.parameters.url,
    mode: 'solo limpieza; no toca notes, clippings ni historial público',
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
