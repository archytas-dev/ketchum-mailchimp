// Dispara los cuatro armados v4 en paralelo. Todos usan modo=test: sólo plano test.
const clients = {
  bms: '99a7b1e3-2b24-4364-a055-be338bfff34a',
  booking: '65170cb4-0646-4602-b5b5-f1b93e6762d4',
  mars: '145311f2-79a0-430b-b528-c9683d1e196f',
  msd: '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026',
};

async function start(slug, client_id) {
  const response = await fetch('https://n8n-ketchum.archytas.io/webhook/v4-armado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id, modo: 'test', fase: 'cerrar' }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${slug}: webhook HTTP ${response.status}: ${body.slice(0, 500)}`);
  return { slug, client_id, response: body.slice(0, 500) };
}

Promise.all(Object.entries(clients).map(([slug, clientId]) => start(slug, clientId)))
  .then((runs) => console.log(JSON.stringify({ modo: 'test', disparadas: runs }, null, 2)))
  .catch((error) => { console.error(error.stack || error.message); process.exit(1); });
