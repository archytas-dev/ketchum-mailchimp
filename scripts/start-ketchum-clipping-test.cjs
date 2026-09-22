// Dispara una prueba completa y aislada del armado v4. El workflow escribe en
// test y el subworkflow de envio limita la prueba a Adrian y Camila.
const clients = {
  mars: '145311f2-79a0-430b-b528-c9683d1e196f',
  booking: '65170cb4-0646-4602-b5b5-f1b93e6762d4',
  msd: '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026',
  bms: '99a7b1e3-2b24-4364-a055-be338bfff34a',
};
const slug = String(process.argv[2] || '').toLowerCase();
const clientId = clients[slug];
const limiteArg = process.argv.indexOf('--limite');
const limiteRaw = limiteArg === -1 ? null : Number.parseInt(process.argv[limiteArg + 1], 10);
const limite = Number.isFinite(limiteRaw) && limiteRaw > 0 ? Math.min(limiteRaw, 30) : null;
const rehacer = process.argv.includes('--rehacer');
const runIdArg = process.argv.indexOf('--run-id');
const runId = runIdArg === -1 ? null : String(process.argv[runIdArg + 1] || '').trim() || null;
if (!clientId) throw new Error(`Uso: node scripts/start-ketchum-clipping-test.cjs <${Object.keys(clients).join('|')}>`);

(async () => {
  const response = await fetch('https://n8n-ketchum.archytas.io/webhook/v4-armado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, modo: 'test', entrega: 'test', rehacer, limite, run_id: runId }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}: ${text.slice(0, 800)}`);
  console.log(JSON.stringify({ started: slug, client_id: clientId, modo: 'test', entrega: 'test', rehacer, limite, run_id: runId, recipients: ['adrian@archytas.io', 'camila@archytas.io'], response: text.slice(0, 500) }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
