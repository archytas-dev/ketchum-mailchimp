// Prueba de humo del prearmado: usa Booking porque su corrida test del día ya
// terminó. El tope 1 evita abrir un barrido nuevo. Nunca puede enviar correo:
// fase=prearmar queda bloqueada antes de Guardar clipping / send-email.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'))
  .mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
const workflowId = 'ORrmePsGxJJxISTo';
const clientId = '65170cb4-0646-4602-b5b5-f1b93e6762d4'; // Booking

async function get(path) {
  const response = await fetch(base + path, { headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
function one(data, name) { return data?.[name]?.at(-1)?.data?.main?.[0]?.[0]?.json || null; }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const startedAfter = new Date().toISOString();
  const trigger = await fetch('https://n8n-ketchum.archytas.io/webhook/v4-armado', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, modo: 'test', fase: 'prearmar', limite: 1 }),
  });
  const triggerText = await trigger.text();
  if (!trigger.ok) throw new Error(`Webhook HTTP ${trigger.status}: ${triggerText.slice(0, 600)}`);

  let found = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const executions = await get(`/api/v1/executions?workflowId=${workflowId}&limit=30`);
    for (const execution of executions.data || []) {
      if (execution.startedAt < startedAfter) continue;
      const detail = await get(`/api/v1/executions/${execution.id}?includeData=true`);
      const data = detail.data?.resultData?.runData || {};
      const cfg = one(data, 'Config');
      if (cfg?.client_id === clientId && cfg?.modo === 'test' && cfg?.fase === 'prearmar') {
        found = { execution, detail, data, cfg };
        break;
      }
    }
    if (found && found.execution.status !== 'running') break;
    await delay(2500);
  }
  if (!found) throw new Error('No apareció la ejecución de humo de prearmado.');

  const lastNode = found.detail.data?.resultData?.lastNodeExecuted || null;
  const prepared = one(found.data, 'Preparar email v3 de prueba');
  const saved = one(found.data, 'Guardar clipping v4 (test)');
  const gate = one(found.data, '¿enviar email de prueba?');
  if (found.execution.status === 'error') throw new Error(`Prearmado falló: ${found.detail.data?.resultData?.error?.message || 'sin detalle'}`);
  if (prepared || saved) throw new Error('Inseguro: una ejecución prearmar llegó a preparar o guardar un clipping.');
  if (!gate) throw new Error(`No se alcanzó la compuerta de seguridad; último nodo: ${lastNode}`);

  console.log(JSON.stringify({
    ok: true,
    executionId: found.execution.id,
    status: found.execution.status,
    config: found.cfg,
    lastNode,
    compuertaEmail: gate,
    clippingGuardado: false,
    emailPreparado: false,
    conclusion: 'prearmar llegó al cierre y se cortó antes de guardar clipping o enviar email',
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
