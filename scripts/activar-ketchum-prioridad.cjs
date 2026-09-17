// Cambia solamente las lecturas de pendientes para que los barridos compartidos
// recorran monitoreados + medios con tier. Las vistas nuevas evitan bloquear las
// vistas que podían estar leyendo ejecuciones ya en curso.
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

const cambios = [
  {
    workflowId: 'tzcHSIUdMGXVRFIo',
    nodeName: 'Leer pendientes del barrido',
    anterior: 'v4_recoleccion_pendientes',
    siguiente: 'v4_recoleccion_prioritaria_pendientes',
  },
  {
    workflowId: 'p6MFCVE8Ggx65Npq',
    nodeName: 'Leer fuentes html',
    anterior: 'v4_recoleccion_html_pendientes',
    siguiente: 'v4_recoleccion_html_prioritaria_pendientes',
  },
];

async function request(path, options = {}) {
  const response = await fetch(base + path, { headers, ...options });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(String(options.method || 'GET') + ' ' + path + ': HTTP ' + response.status + ': ' + body.slice(0, 800));
  }
  return body ? JSON.parse(body) : {};
}

function node(workflow, name) {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error('No encontré el nodo ' + name + ' en ' + workflow.name + '.');
  return found;
}

(async () => {
  const publicados = [];
  for (const cambio of cambios) {
    const workflow = await request('/api/v1/workflows/' + cambio.workflowId);
    const target = node(workflow, cambio.nodeName);
    const url = String(target.parameters?.url || '');
    if (!url.includes(cambio.anterior) && !url.includes(cambio.siguiente)) {
      throw new Error(workflow.name + ' no apunta a la vista esperada: ' + url);
    }
    target.parameters.url = url.replace(cambio.anterior, cambio.siguiente);
    await request('/api/v1/workflows/' + cambio.workflowId, {
      method: 'PUT',
      body: JSON.stringify({
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings || {},
      }),
    });
    await request('/api/v1/workflows/' + cambio.workflowId + '/publish', { method: 'POST', body: '{}' });
    const verified = await request('/api/v1/workflows/' + cambio.workflowId);
    const active = verified.activeVersion || verified;
    const activeUrl = String(node(active, cambio.nodeName).parameters?.url || '');
    if (!activeUrl.includes(cambio.siguiente)) {
      throw new Error(verified.name + ' se publicó sin la vista prioritaria.');
    }
    publicados.push({ id: verified.id, name: verified.name, node: cambio.nodeName, url: activeUrl });
  }
  console.log(JSON.stringify({ publicados }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
