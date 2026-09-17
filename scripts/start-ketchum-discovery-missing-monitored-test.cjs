(async () => {
  const dominios = [
    'pinamar24.com.ar', 'pmfarma.com', 'rosario3.com',
    'viajesynoticias.com.ar', 'voydeviaje.com.ar',
    'agrohoy.ar', 'informerural.com.ar', 'news.agrofy.com.ar',
    'resumenregional.com.ar', 'valoragro.com.ar', 'vetcomunicaciones.com.ar',
    'forbesargentina.com', 'webretail.com.ar',
    'ciap.org.ar', 'dataportuaria.ar'
  ];
  const response = await fetch('https://n8n-ketchum.archytas.io/webhook/v4-descubridor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cliente: 'todos', grupo: 'todos', dominios, limite: 30, offset: 0, modo: 'test' }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}: ${body.slice(0, 1000)}`);
  console.log(body);
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
