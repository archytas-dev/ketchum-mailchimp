const tipo = String(process.argv[2] || '').toLowerCase();
const rutas = {
  feeds: 'v4-barrido',
  html: 'v4-barrido-html',
};
if (!rutas[tipo]) throw new Error('Uso: node scripts/start-ketchum-recoleccion-completa-prueba.cjs <feeds|html>');

(async () => {
  const response = await fetch('https://n8n-ketchum.archytas.io/webhook/' + rutas[tipo], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // "prod" acá sólo persiste las notas fuente en candidatas_raw, como hacen
    // los barridos. El armado que sigue usa schema test y no marca ni consume
    // el pool de ningún cliente.
    body: JSON.stringify({ modo: 'prod', scope: 'completa_prueba', limite: tipo === 'feeds' ? 60 : 10, max_tandas: tipo === 'feeds' ? 25 : 20 }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}: ${body.slice(0, 1000)}`);
  console.log(body);
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
