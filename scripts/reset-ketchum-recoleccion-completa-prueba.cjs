// Reinicia exclusivamente los intentos de la pasada completa de prueba de hoy.
// No borra candidatas, pool, ni historial de envios.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const token = fs.readFileSync(path.join(root, '.env.mgmt'), 'utf8').split(/\r?\n/)
  .find((line) => line.startsWith('SUPABASE_ACCESS_TOKEN='))?.split('=')[1]?.trim();
const projectRef = fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim();
if (!token || !projectRef) throw new Error('Falta configuracion de Supabase.');

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text);
}

(async () => {
  await query(`begin;
    delete from public.fetch_log
    where fecha = public.v4_hoy()
      and pasada = 'prueba_completa_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
  commit;`);
  console.log(JSON.stringify({ ok: true, afecta: 'solo fetch_log de la prueba completa de hoy; candidatas, pool e historial intactos' }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
