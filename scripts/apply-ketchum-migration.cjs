// Aplica una migracion puntual al Supabase remoto y deja registro en el ledger
// de migraciones. Se usa cuando el historial remoto tiene cambios operativos
// que no estan como archivos locales y `supabase db push` no es seguro.
const fs = require('fs');
const path = require('path');

const migration = process.argv[2];
if (!migration) throw new Error('Uso: node scripts/apply-ketchum-migration.cjs <archivo.sql>');
const fullPath = path.resolve(migration);
const baseName = path.basename(fullPath);
const match = baseName.match(/^(\d+)_(.+)\.sql$/);
if (!match) throw new Error(`Nombre de migracion invalido: ${baseName}`);

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env.mgmt');
const tokenLine = fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .find((line) => line.startsWith('SUPABASE_ACCESS_TOKEN='));
const token = tokenLine?.slice('SUPABASE_ACCESS_TOKEN='.length).trim();
const projectRef = fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim();
if (!token || !projectRef) throw new Error('Falta la configuracion de Supabase remoto.');

const sql = fs.readFileSync(fullPath, 'utf8').trim();
if (sql.includes('$migration$')) throw new Error('El delimitador interno $migration$ ya esta usado.');
const version = match[1];
const name = match[2];
const escapedName = name.replace(/'/g, "''");
const query = `begin;
${sql}
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('${version}', '${escapedName}', array[$migration$${sql}$migration$]);
commit;`;

(async () => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${body.slice(0, 1200)}`);
  console.log(JSON.stringify({ applied: baseName, project: projectRef }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
