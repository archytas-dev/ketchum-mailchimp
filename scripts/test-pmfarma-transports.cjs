const url = process.argv.includes('--listado')
  ? 'https://www.pmfarma.com/app/noticias'
  : 'https://www.pmfarma.com/app/noticias/62582-bristol-myers-squibb-refuerza-su-compromiso-historico-con-la-investigacion-en-cancer-a-traves-de-su-iniciativa-c2c4c';
const endpoint = 'https://n8n-ketchum.archytas.io/webhook/v4-test-open';
(async () => {
  const results = [];
  for (const transporte of ['directo', 'cloudflare', 'aws', 'brightdata']) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [{ url, dominio_norm: 'pmfarma.com', transporte }] }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${transporte}: HTTP ${response.status}: ${body.slice(0, 1200)}`);
    results.push({ transporte, resultado: JSON.parse(body) });
  }
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
