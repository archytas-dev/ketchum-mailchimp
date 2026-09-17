const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function listAll() {
  const all = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ limit: '250' });
    if (cursor) params.set('cursor', cursor);
    const page = await get(`/api/v1/workflows?${params}`);
    all.push(...(page.data || []));
    cursor = page.nextCursor || null;
  } while (cursor);
  return all;
}

function type(node) {
  return String(node.type || '').split('.').at(-1);
}

(async () => {
  const inventory = await listAll();
  if (process.argv.includes('--names')) {
    console.log(JSON.stringify(inventory.filter((workflow) => /v4|recolecci|descubridor|medir-html|armado-cliente/i.test(workflow.name || '')).map(({ id, name, active }) => ({ id, name, active })), null, 2));
    return;
  }
  const selected = inventory.filter((workflow) => /v4|recolecci|descubridor|medir-html|armado-cliente/i.test(workflow.name || ''));
  const report = await Promise.all(selected.map(async (entry) => {
    const workflow = await get(`/api/v1/workflows/${entry.id}`);
    const active = workflow.activeVersion || workflow;
    const nodes = active.nodes || [];
    const triggers = nodes.filter((node) => /scheduleTrigger|cron|webhook/i.test(node.type || '')).map((node) => ({
      name: node.name,
      type: type(node),
      parameters: node.parameters,
      disabled: !!node.disabled,
    }));
    const batching = nodes.filter((node) => /splitInBatches|loopOverItems/i.test(node.type || '') || /lote|batch|tanda|pagina/i.test(node.name || '')).map((node) => ({
      name: node.name,
      type: type(node),
      parameters: node.parameters,
      disabled: !!node.disabled,
    }));
    const writes = nodes.filter((node) => /supabase|postgres|httpRequest/i.test(node.type || '') && /guardar|insert|upsert|pool|candidata|veredicto|terminar|cerrar/i.test(node.name || '')).map((node) => ({ name: node.name, type: type(node), disabled: !!node.disabled }));
    const executions = await get(`/api/v1/executions?workflowId=${entry.id}&limit=5`);
    return {
      id: entry.id,
      name: entry.name,
      active: entry.active,
      triggers,
      batching,
      writes,
      recent: (executions.data || []).map(({ id, status, startedAt, stoppedAt, mode }) => ({ id, status, startedAt, stoppedAt, mode })),
    };
  }));
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
