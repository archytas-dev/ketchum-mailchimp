const fs = require('fs');
const path = require('path');

const csvPath = 'C:\\Users\\Usuario\\Downloads\\Medios-Circulacion y Readership 2026  (1).xlsx -  (Ad Value-Tier-Alcance) (1).csv';
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\b(online|web|com|ar|digital|diario|portal|noticias|el|la|los|las)\b/g, ' ')
    .replace(/ +/g, ' ').trim();
}
function integer(s) { const v = String(s || '').replace(/[^0-9]/g, ''); return v ? Number(v) : null; }
async function db(query) {
  const root = path.resolve(__dirname, '..');
  const token = fs.readFileSync(path.join(root, '.env.mgmt'), 'utf8').split(/\r?\n/).find(x => x.startsWith('SUPABASE_ACCESS_TOKEN='))?.split('=')[1]?.trim();
  const ref = fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim();
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + (await res.text()).slice(0, 600));
  return res.json();
}
(async () => {
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const header = rows.shift();
  const col = Object.fromEntries(header.map((v, i) => [v.trim(), i]));
  const csv = new Map();
  for (const r of rows) {
    const medio = String(r[col.H1] || '').trim();
    if (!medio || /^https?:/i.test(medio)) continue;
    const key = norm(medio); if (!key) continue;
    csv.set(key, { medio, tier: integer(r[col.TIER]), alcance: integer(r[col['Daily Visitors/ Alcance']]), ad_value: integer(r[col['VAP/ Ad Value 2026']]) });
  }
  // Los tiers se replican por cliente. BMS contiene la misma tabla maestra y
  // evita agrupar las miles de copias para esta comparacion de solo lectura.
  const existing = await db("select medio,tier,alcance,ad_value from public.tiers where client_id='99a7b1e3-2b24-4364-a055-be338bfff34a' and medio is not null");
  const dbRows = new Map();
  for (const r of existing) { const key = norm(r.medio); if (key) dbRows.set(key, r); }
  let iguales = 0, distintos = 0; const changes = [], csvOnly = [];
  for (const [key, row] of csv) {
    const old = dbRows.get(key);
    if (!old) { csvOnly.push(row); continue; }
    const same = Number(old.tier) === row.tier && Number(old.alcance) === row.alcance && Number(old.ad_value) === row.ad_value;
    if (same) iguales++; else { distintos++; if (changes.length < 30) changes.push({ medio: row.medio, csv: row, actual: old }); }
  }
  const dbOnly = [...dbRows.entries()].filter(([key]) => !csv.has(key)).slice(0, 30).map(([, row]) => row);
  console.log(JSON.stringify({ csv_medios: csv.size, tiers_actuales: dbRows.size, iguales, distintos, solo_csv: csvOnly.length, solo_actual: [...dbRows.keys()].filter(k => !csv.has(k)).length, ejemplos_distintos: changes, ejemplos_solo_csv: csvOnly.slice(0, 30), ejemplos_solo_actual: dbOnly }, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
