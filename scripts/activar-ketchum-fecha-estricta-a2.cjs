const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta ketchum-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = '9pwrSH2KdpGhbXjS';
const nodeName = 'Aplicar el veredicto';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${body.slice(0, 1200)}`);
  return body ? JSON.parse(body) : {};
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const nodes = active.nodes || [];
  const node = nodes.find(n => n.name === nodeName);
  if (!node) throw new Error(`No existe ${nodeName}.`);
  const code = String(node.parameters?.jsCode || '');
  const marker = "  if (entra && !seccion) { seccion = porDefecto; forzada = true; motivo = (motivo ? motivo + '; ' : '') + 'entra sin seccion asignada'; }";
  const strict = "  // Fecha estricta: A1 ya abrio la nota. Si ni el feed ni el cuerpo dieron una fecha real,\n  // no puede entrar por haber sido capturada hoy. Esta regla vence incluso una prioridad.\n  if (n.fecha_confiable !== true || !n.fecha_pub) {\n    entra = false; forzada = true;\n    motivo = (motivo ? motivo + '; ' : '') + 'sin fecha confiable en feed ni cuerpo de la nota';\n  }";
  if (!code.includes(strict)) {
    if (!code.includes(marker)) throw new Error('El codigo del A2 cambio; no se publica a ciegas.');
    node.parameters.jsCode = code.replace(marker, `${marker}\n${strict}`);
  }
  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes, connections: active.connections || workflow.connections || {}, settings: active.settings || workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const checked = (verified.activeVersion || verified).nodes.find(n => n.name === nodeName);
  if (!String(checked?.parameters?.jsCode || '').includes('sin fecha confiable en feed ni cuerpo de la nota')) {
    throw new Error('La regla de fecha estricta no quedo publicada.');
  }
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, fecha_estricta: true }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
