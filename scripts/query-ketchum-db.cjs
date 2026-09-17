// Consulta de diagnostico al proyecto remoto. Lee SQL desde stdin para evitar
// poner secretos o consultas largas en la linea de comandos.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const token = fs.readFileSync(path.join(root, '.env.mgmt'), 'utf8').split(/\r?\n/)
  .find((line) => line.startsWith('SUPABASE_ACCESS_TOKEN='))?.split('=')[1]?.trim();
const projectRef = fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim();
const query = (process.argv[2] || fs.readFileSync(0, 'utf8')).trim();
if (!token || !projectRef || !query) throw new Error('Falta configuracion o consulta.');
(async () => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${text.slice(0, 3000)}`);
  process.stdout.write(text);
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
