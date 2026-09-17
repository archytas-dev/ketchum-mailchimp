// Aumenta solo una tanda en cada barrido v4. Los lotes se mantienen chicos:
// 60 feeds y 10 HTML, para conservar el margen contra OOM.
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

const cambios = [
  { id: 'wEuM4z6hIuLGwQFF', nombre: 'feeds', antes: '|| 25, 1), 40)', despues: '|| 26, 1), 40)' },
  { id: 'Zm8OhzNmu0uLs2JA', nombre: 'html', antes: '|| 20, 1), 40)', despues: '|| 22, 1), 40)' },
];

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) : null;
}

(async () => {
  const resultado = [];
  for (const cambio of cambios) {
    const workflow = await request(`/api/v1/workflows/${cambio.id}`);
    const node = (workflow.nodes || []).find((item) => item.name === 'Config');
    if (!node?.parameters?.jsCode) throw new Error(`${cambio.nombre}: no se encontro Config.`);
    if (!node.parameters.jsCode.includes(cambio.antes)) {
      throw new Error(`${cambio.nombre}: configuracion inesperada; no se publica nada.`);
    }
    node.parameters.jsCode = node.parameters.jsCode.replace(cambio.antes, cambio.despues);
    await request(`/api/v1/workflows/${cambio.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }),
    });
    await request(`/api/v1/workflows/${cambio.id}/publish`, { method: 'POST', body: '{}' });
    const verified = await request(`/api/v1/workflows/${cambio.id}`);
    const active = verified.activeVersion || verified;
    const activeConfig = (active.nodes || []).find((item) => item.name === 'Config')?.parameters?.jsCode || '';
    if (!activeConfig.includes(cambio.despues)) throw new Error(`${cambio.nombre}: la version activa no tiene el nuevo tope.`);
    resultado.push({ workflow: verified.name, max_tandas: cambio.nombre === 'feeds' ? 26 : 22 });
  }
  console.log(JSON.stringify(resultado, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
