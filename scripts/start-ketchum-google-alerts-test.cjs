(async () => {
  const response = await fetch('https://n8n-ketchum.archytas.io/webhook/v4-alertas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modo: 'test', limite: 150, offset: 0 }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}: ${body.slice(0, 1000)}`);
  console.log(body);
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
