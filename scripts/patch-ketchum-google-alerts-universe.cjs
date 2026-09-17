const fs = require('fs');

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
  const configNode = nodes.find((node) => node.name === 'Config');
  const readNode = nodes.find((node) => node.name === 'Leer alertas pendientes');
  const batchNode = nodes.find((node) => node.name === 'Armar pedidos');
  if (!configNode || !readNode || !batchNode) throw new Error('Falta un nodo esperado; no se modifica el workflow.');

  const oldConfig = String(configNode.parameters?.jsCode || '');
  const oldDefault = "limite: Math.min(Math.max(parseInt(b.limite, 10) || 40, 1), 150),";
  const newDefault = "limite: Math.min(Math.max(parseInt(b.limite, 10) || 150, 1), 200),";
  if (!oldConfig.includes(oldDefault) && !oldConfig.includes(newDefault)) {
    throw new Error('El límite de Config cambió; no publico a ciegas.');
  }
  configNode.parameters.jsCode = oldConfig.replace(oldDefault, newDefault);

  const params = readNode.parameters?.queryParameters?.parameters || [];
  const order = params.find((parameter) => parameter.name === 'order');
  if (order) order.value = 'client_id.asc,alerta_id.asc';
  else params.push({ name: 'order', value: 'client_id.asc,alerta_id.asc' });
  readNode.parameters.queryParameters.parameters = params;

  const oldBatch = String(batchNode.parameters?.jsCode || '');
  const guard = "if (filas.length >= cfg.limite) throw new Error('ALERTAS_INCOMPLETAS: la lectura llegó al límite; falta ampliar o paginar el universo antes de procesar.');";
  if (!oldBatch.includes(guard)) {
    const marker = "console.log('[alertas ' + cfg.pasada + '] tanda=' + filas.length + ' offset=' + cfg.offset + ' modo=' + cfg.modo);";
    if (!oldBatch.includes(marker)) throw new Error('El código de Armar pedidos cambió; no publico a ciegas.');
    batchNode.parameters.jsCode = oldBatch.replace(marker, `${marker}\nif (filas.length >= cfg.limite) throw new Error('ALERTAS_INCOMPLETAS: la lectura llegó al límite; falta ampliar o paginar el universo antes de procesar.');`);
  }

  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes, connections: workflow.connections, settings: workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });

  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const active = verified.activeVersion || verified;
  const activeConfig = active.nodes.find((node) => node.name === 'Config');
  const activeRead = active.nodes.find((node) => node.name === 'Leer alertas pendientes');
  const activeBatch = active.nodes.find((node) => node.name === 'Armar pedidos');
  const activeConfigCode = String(activeConfig?.parameters?.jsCode || '');
  const activeParams = activeRead?.parameters?.queryParameters?.parameters || [];
  const activeOrder = activeParams.find((parameter) => parameter.name === 'order')?.value;
  const activeBatchCode = String(activeBatch?.parameters?.jsCode || '');
  if (!activeConfigCode.includes(newDefault)) throw new Error('La versión activa no tiene el límite nuevo.');
  if (activeOrder !== 'client_id.asc,alerta_id.asc') throw new Error('La versión activa no tiene orden estable.');
  if (!activeBatchCode.includes('ALERTAS_INCOMPLETAS')) throw new Error('La versión activa no tiene el guard de truncamiento.');

  console.log(JSON.stringify({
    workflow: verified.name,
    activeVersionId: verified.activeVersionId,
    defaultLimit: 150,
    maxLimit: 200,
    stableOrder: activeOrder,
    truncationGuard: true,
    writes: 'sin cambios de datos; solo se actualizó el workflow',
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
