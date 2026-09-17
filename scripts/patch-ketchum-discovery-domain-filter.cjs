const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'nvShglwLuHqgF5cp';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : null;
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const nodes = workflow.nodes || [];
  const configNode = nodes.find(n => n.name === 'Config');
  const pendingNode = nodes.find(n => n.name === 'Armar pendientes');
  if (!configNode || !pendingNode) throw new Error('Falta Config o Armar pendientes; no se modifica.');

  const configCode = String(configNode.parameters?.jsCode || '');
  const configMarker = "const modo   = String(b.modo || 'test').toLowerCase() === 'prod' ? 'prod' : 'test';";
  const configInsert = "const requestedDomains = Array.isArray(b.dominios) ? b.dominios : String(b.dominios || '').split(',');\nconst dominios = [...new Set(requestedDomains.map(x => String(x || '').trim().toLowerCase().replace(/^www\\./, '')).filter(Boolean))];";
  if (!configCode.includes(configInsert)) {
    if (!configCode.includes(configMarker)) throw new Error('El código de Config cambió; no publico a ciegas.');
    configNode.parameters.jsCode = configCode.replace(configMarker, `${configInsert}\n\n${configMarker}`);
  }
  const updatedConfig = String(configNode.parameters.jsCode || '');
  const returnMarker = "clientId, grupo, limite, offset, modo,";
  if (!updatedConfig.includes("clientId, grupo, limite, offset, modo,\n  pasada:")) {
    if (!updatedConfig.includes(returnMarker)) throw new Error('No encontré el retorno de Config.');
    configNode.parameters.jsCode = updatedConfig.replace(returnMarker, "clientId, grupo, limite, offset, modo, dominios,\n  pasada:");
  }

  const pendingCode = String(pendingNode.parameters?.jsCode || '');
  const pendingMarker = "const pend = [];";
  const pendingInsert = "const filtroDominios = new Set(cfg.dominios || []);\n\n";
  if (!pendingCode.includes(pendingInsert)) {
    if (!pendingCode.includes(pendingMarker)) throw new Error('El código de Armar pendientes cambió; no publico a ciegas.');
    pendingNode.parameters.jsCode = pendingCode.replace(pendingMarker, `${pendingInsert}${pendingMarker}`);
  }
  const updatedPending = String(pendingNode.parameters.jsCode || '');
  const loopMarker = "for (const f of fuentes) {\n  if (cfg.clientId && !suscritas.has(f.id)) continue;";
  const loopReplacement = "for (const f of fuentes) {\n  if (filtroDominios.size && !filtroDominios.has(String(f.dominio_norm || '').toLowerCase())) continue;\n  if (cfg.clientId && !suscritas.has(f.id)) continue;";
  if (!updatedPending.includes(loopReplacement)) {
    if (!updatedPending.includes(loopMarker)) throw new Error('No encontré el loop de pendientes.');
    pendingNode.parameters.jsCode = updatedPending.replace(loopMarker, loopReplacement);
  }

  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes, connections: workflow.connections, settings: workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const active = verified.activeVersion || verified;
  const activeConfig = active.nodes.find(n => n.name === 'Config');
  const activePending = active.nodes.find(n => n.name === 'Armar pendientes');
  if (!String(activeConfig?.parameters?.jsCode || '').includes('const dominios =')) throw new Error('No quedó el filtro de dominios activo.');
  if (!String(activePending?.parameters?.jsCode || '').includes('filtroDominios.size')) throw new Error('No quedó el filtro en pendientes.');
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, domainFilter: true, mode: 'test-only when requested' }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
