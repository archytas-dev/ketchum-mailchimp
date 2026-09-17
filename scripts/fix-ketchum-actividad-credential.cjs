// Copia la credencial Supabase de un nodo v4 existente al snapshot de Actividad.
// No modifica URL, datos, modo ni ninguna rama del workflow.
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = 'ORrmePsGxJJxISTo';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : null;
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${workflowId}`);
  const active = workflow.activeVersion || workflow;
  const nodes = active.nodes || [];
  const source = nodes.find((node) => node.name === 'Guardar veredictos' && node.credentials?.supabaseApi);
  const target = nodes.find((node) => node.name === 'Guardar foto de Actividad v4');
  if (!source) throw new Error('No encontre un nodo v4 con credencial supabaseApi para copiar.');
  if (!target) throw new Error('No existe Guardar foto de Actividad v4.');
  if (target.credentials?.supabaseApi?.id === source.credentials.supabaseApi.id) {
    console.log(JSON.stringify({ ok: true, changed: false, reason: 'ya tenia la misma credencial' }, null, 2));
    return;
  }
  target.credentials = { ...(target.credentials || {}), supabaseApi: { ...source.credentials.supabaseApi } };
  await request(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: workflow.name, nodes, connections: active.connections, settings: active.settings || workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${workflowId}/publish`, { method: 'POST', body: '{}' });
  const verified = await request(`/api/v1/workflows/${workflowId}`);
  const published = verified.activeVersion || verified;
  const checked = (published.nodes || []).find((node) => node.name === 'Guardar foto de Actividad v4');
  if (checked?.credentials?.supabaseApi?.id !== source.credentials.supabaseApi.id) {
    throw new Error('La version activa no quedo con la credencial esperada.');
  }
  console.log(JSON.stringify({ ok: true, changed: true, workflow: verified.name, activeVersionId: verified.activeVersionId }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
