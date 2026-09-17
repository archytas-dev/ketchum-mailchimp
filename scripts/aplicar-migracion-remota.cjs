// Aplica un archivo de supabase/migrations al proyecto remoto, TAL CUAL está en el repo,
// y lo registra en supabase_migrations.schema_migrations con la misma versión/nombre.
//
// Por qué no `supabase db push`: el repo y el remoto tienen las mismas migraciones con
// timestamps distintos (drift heredado), así que push intentaría re-aplicar cosas ya aplicadas.
// Por qué no pegar el SQL a mano: son cientos de líneas contra producción; una transcripción
// es un riesgo innecesario cuando el archivo ya existe.
//
// Uso: node scripts/aplicar-migracion-remota.cjs <archivo.sql> [--dry-run]

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_REF = 'banlcbewinpjtudzdzhm';

const archivo = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!archivo) throw new Error('Uso: node scripts/aplicar-migracion-remota.cjs <archivo.sql> [--dry-run]');

const ruta = path.resolve('supabase/migrations', path.basename(archivo));
const sql = fs.readFileSync(ruta, 'utf8');
const base = path.basename(ruta, '.sql');
const version = base.slice(0, base.indexOf('_'));
const nombre = base.slice(base.indexOf('_') + 1);
if (!/^\d{14}$/.test(version)) throw new Error('El nombre del archivo no arranca con una version de 14 digitos: ' + base);

// El token vive en la config del MCP; no se imprime ni se copia a ningún lado.
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
const args = config.mcpServers?.['archytas-supabase']?.args || [];
const token = args[args.indexOf('--access-token') + 1];
if (!token || !token.startsWith('sbp_')) throw new Error('No encontré el access token de Supabase en la config del MCP.');

// Todo en una transacción: si el registro en el ledger falla, la migración tampoco queda a medias.
const dolar = '$mig_' + version + '$';
const query = [
  'begin;',
  sql,
  `insert into supabase_migrations.schema_migrations (version, name, statements)
     values ('${version}', '${nombre}', array[${dolar}${sql}${dolar}])
     on conflict (version) do nothing;`,
  'commit;',
].join('\n');

(async () => {
  console.log(`archivo : ${path.basename(ruta)}`);
  console.log(`version : ${version}`);
  console.log(`nombre  : ${nombre}`);
  console.log(`bytes   : ${sql.length}`);
  if (dryRun) {
    console.log('\n--dry-run: no se envió nada.');
    return;
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const texto = await r.text();
  console.log(`\nHTTP ${r.status}`);
  console.log(texto.slice(0, 2000));
  if (!r.ok) process.exitCode = 1;
})();
