const fs = require('fs');
const workflowId = process.argv[2];
const nodeName = process.argv[3];
if (!workflowId || !nodeName) throw new Error('Uso: node scripts/check-ketchum-node-code.cjs <workflow-id> <nodo>');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
(async () => {
  const response = await fetch(`${base}/api/v1/workflows/${workflowId}`, { headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const workflow = await response.json();
  const active = workflow.activeVersion || workflow;
  const node = (active.nodes || []).find((item) => item.name === nodeName);
  if (!node) throw new Error(`No existe ${nodeName}`);
  const code = String(node.parameters?.jsCode || '');
  new Function(code);
  const out = process.argv.includes('--smoke')
    ? new Function('items', code)([{ json: {
      url: 'https://medio.test/nota', dominio_norm: 'medio.test', diagnostico: 'ok', bytes: 1200,
      html: '<html><head><meta property="og:title" content="Una noticia de prueba sobre salud"><meta property="og:description" content="Esta es una descripción suficientemente larga para verificar que el extractor la devuelve correctamente al completador."><meta property="article:published_time" content="2026-09-14T12:00:00Z"></head><body><h1>Una noticia de prueba sobre salud</h1><p>Este es el primer párrafo de contexto de la nota y tiene contenido suficiente para probar la extracción.</p></body></html>'
    } }])
    : null;
  console.log(JSON.stringify({ ok: true, workflowId, node: nodeName, chars: code.length, smoke: out ? out[0].json : null }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
