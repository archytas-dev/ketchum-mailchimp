const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const mgmt = fs.readFileSync('.env.mgmt', 'utf8').split(/\r?\n/)
  .find((line) => line.startsWith('SUPABASE_ACCESS_TOKEN='))?.split('=')[1]?.trim();
const project = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();

async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${mgmt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}
function findDate(html) {
  const patterns = [
    /(?:datePublished|article:published_time)[^>]{0,180}(?:content=["'])?([^"'<> ]{10,40})/i,
    /(?:<time[^>]+datetime=["'])([^"']{10,40})/i,
    /(?:fecha|date)[^>]{0,100}(?:content=["'])(20\d\d[-/]\d\d[-/]\d\d[^"']*)/i,
    /\b(20\d\d[-/]\d\d[-/]\d\d(?:[T ]\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:?\d\d)?)?)/,
    /\b(\d\d[/-]\d\d[/-]20\d\d(?:\s+\d\d:\d\d)?)/,
  ];
  for (const pattern of patterns) {
    const hit = html.match(pattern);
    if (hit) return hit[1];
  }
  return null;
}
async function inspect(row) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(row.url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArchytasDateAudit/1.0)' } });
    const html = await response.text();
    return { ...row, http: response.status, bytes: html.length, fecha_directa: findDate(html), resultado: findDate(html) ? 'fecha_en_pagina' : 'sin_fecha_detectable' };
  } catch (error) {
    return { ...row, http: null, bytes: 0, fecha_directa: null, resultado: `error_${error.name}` };
  } finally { clearTimeout(timer); }
}
(async () => {
  const rows = await sql(`
    with fuentes_relevantes as (
      select distinct f.dominio_norm
      from public.medios_fuentes f join public.medios_suscripcion s on s.fuente_id=f.id
      where f.activa and (s.prioritario or s.tier is not null)
    ), candidatas as (
      select distinct on (c.dominio_norm) c.dominio_norm,c.url,c.titulo,c.capturado_at
      from public.candidatas_raw c join fuentes_relevantes f using(dominio_norm)
      where c.fecha=public.v4_hoy() and c.fecha_pub is null and c.url like 'http%'
      order by c.dominio_norm,c.capturado_at desc
    ) select * from candidatas order by dominio_norm
  `);
  const results = [];
  for (let i = 0; i < rows.length; i += 8) results.push(...await Promise.all(rows.slice(i, i + 8).map(inspect)));
  const summary = results.reduce((acc, row) => { acc[row.resultado] = (acc[row.resultado] || 0) + 1; return acc; }, {});
  console.log(JSON.stringify({ total: results.length, resumen: summary, resultados: results }, null, 2));
})().catch((error) => { console.error(error.stack || error.message, error.cause?.message || ''); process.exit(1); });
