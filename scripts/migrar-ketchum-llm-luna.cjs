// Conserva el contrato Chat Completions que consume A2 y cambia solamente el
// default del juez a GPT-5.6 Luna. Para Luna no se manda temperature y se fija
// reasoning_effort=none como línea base de latencia para la prueba.
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const workflowId = '8xgMfLdQLuwkpVgr';

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
  if (!found) throw new Error('No encontré el nodo ' + name + '.');
  return found;
}

(async () => {
  const workflow = await request('/api/v1/workflows/' + workflowId);
  const defaults = node(workflow, 'Defaults');
  const call = node(workflow, 'Llamar al modelo');

  const defaultsBefore = String(defaults.parameters.jsCode || '');
  if (!defaultsBefore.includes("modelo: String(q.modelo || 'gpt-4o')") &&
      !defaultsBefore.includes("modelo: String(q.modelo || 'gpt-5.6-luna')")) {
    throw new Error('El default actual no es el esperado; no se publica a ciegas.');
  }
  defaults.parameters.jsCode = defaultsBefore
    .replace(/gpt-4o y 0\.1[^\n]*/, 'GPT-5.6 Luna es el default del juez por volumen y costo; el contrato de salida se mantiene.')
    .replace("modelo: String(q.modelo || 'gpt-4o')", "modelo: String(q.modelo || 'gpt-5.6-luna')");

  const callBefore = String(call.parameters.jsCode || '');
  const oldBody = [
    'const body = {',
    '  model: req.modelo,',
    '  temperature: req.temperatura,',
    "  messages: [{ role: 'system', content: system }, { role: 'user', content: req.user }]",
    '};',
    "if (req.json_mode) body.response_format = { type: 'json_object' };",
    'if (req.max_tokens) body.max_tokens = req.max_tokens;',
  ].join('\n');
  const newBody = [
    'const body = {',
    '  model: req.modelo,',
    "  messages: [{ role: 'system', content: system }, { role: 'user', content: req.user }]",
    '};',
    "if (req.modelo === 'gpt-5.6-luna') {",
    '  // Base comparable al juez anterior: máxima velocidad para clasificación.',
    '  // Luna soporta none, low, medium, high, xhigh y max; no se sube esfuerzo',
    '  // sin medir primero el resultado de los cuatro clippings.',
    "  body.reasoning_effort = 'none';",
    '} else {',
    '  body.temperature = req.temperatura;',
    '}',
    "if (req.json_mode) body.response_format = { type: 'json_object' };",
    'if (req.max_tokens) body.max_tokens = req.max_tokens;',
  ].join('\n');
  if (!callBefore.includes(oldBody) && !callBefore.includes("body.reasoning_effort = 'none'")) {
    throw new Error('El armado de la llamada no coincide con el contrato esperado.');
  }
  call.parameters.jsCode = callBefore.includes(oldBody) ? callBefore.replace(oldBody, newBody) : callBefore;

  await request('/api/v1/workflows/' + workflowId, {
    method: 'PUT',
    body: JSON.stringify({
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: workflow.settings || {},
    }),
  });
  await request('/api/v1/workflows/' + workflowId + '/publish', { method: 'POST', body: '{}' });

  const verified = await request('/api/v1/workflows/' + workflowId);
  const active = verified.activeVersion || verified;
  const activeDefaults = String(node(active, 'Defaults').parameters.jsCode || '');
  const activeCall = String(node(active, 'Llamar al modelo').parameters.jsCode || '');
  const checks = {
    modeloLuna: activeDefaults.includes("modelo: String(q.modelo || 'gpt-5.6-luna')"),
    lunaSinTemperature: activeCall.includes("req.modelo === 'gpt-5.6-luna'") && activeCall.includes("body.reasoning_effort = 'none'"),
    jsonContract: activeCall.includes("response_format = { type: 'json_object' }"),
  };
  if (Object.values(checks).some((value) => !value)) {
    throw new Error('Publicación incompleta: ' + JSON.stringify(checks));
  }
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, checks }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
