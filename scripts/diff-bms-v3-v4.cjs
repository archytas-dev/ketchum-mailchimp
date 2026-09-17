const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));

function connection(name) {
  const env = config.mcpServers?.[name]?.env;
  if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error(`Falta la conexion ${name}.`);
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}

async function execution(connectionInfo, id) {
  const response = await fetch(`${connectionInfo.base}/api/v1/executions/${id}?includeData=true`, { headers: connectionInfo.headers });
  if (!response.ok) throw new Error(`Ejecucion ${id}: HTTP ${response.status}`);
  return response.json();
}

function lastJson(runData, node) {
  const runs = runData[node] || [];
  return runs.at(-1)?.data?.main?.[0]?.[0]?.json || null;
}

function unwrap(url) {
  let current = String(url || '').trim();
  for (let i = 0; i < 2; i += 1) {
    try {
      const parsed = new URL(current);
      const target = ['url', 'q', 'u', 'redirect'].map((key) => parsed.searchParams.get(key)).find(Boolean);
      if (!target) break;
      current = decodeURIComponent(target);
    } catch { break; }
  }
  return current;
}

function canonicalUrl(value) {
  const current = unwrap(value);
  try {
    const parsed = new URL(current);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$|ref$|referrer$)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch { return current.toLowerCase().replace(/\/$/, ''); }
}

function title(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function notesFromV4(payload) {
  const root = payload?.body || payload || {};
  const sections = root.secciones || [];
  return sections.flatMap((section) => {
    const notes = section.notas || section.noticias || section.items || [];
    return notes.map((note) => ({
      ...note,
      seccion: note.seccion || section.seccion || section.nombre || section.titulo || 'Sin grupo',
      url: note.url || note.url_canonica,
    }));
  });
}

function perSection(rows) {
  return Object.fromEntries([...rows.reduce((map, row) => map.set(row.seccion || 'Sin grupo', (map.get(row.seccion || 'Sin grupo') || 0) + 1), new Map())].sort());
}

(async () => {
  const [v3, v4] = await Promise.all([
    execution(connection('archytas-n8n'), '202822'),
    execution(connection('ketchum-n8n'), '6574'),
  ]);
  const v3Data = v3.data?.resultData?.runData || {};
  const v4Data = v4.data?.resultData?.runData || {};
  const oldNotes = lastJson(v3Data, 'Prep Supabase Rows')?.notes || [];
  const newNotes = notesFromV4(lastJson(v4Data, 'Armar clipping BMS para email de prueba'));
  if (!oldNotes.length || !newNotes.length) throw new Error(`No se pudieron leer las notas: v3=${oldNotes.length}, v4=${newNotes.length}.`);

  const byUrl = new Map();
  const byTitle = new Map();
  newNotes.forEach((note, index) => {
    const u = canonicalUrl(note.url);
    const t = title(note.titulo);
    if (u) byUrl.set(u, [...(byUrl.get(u) || []), index]);
    if (t) byTitle.set(t, [...(byTitle.get(t) || []), index]);
  });
  const used = new Set();
  const matches = [];
  const onlyV3 = [];
  for (const oldNote of oldNotes) {
    const urls = (byUrl.get(canonicalUrl(oldNote.url)) || []).filter((index) => !used.has(index));
    const titles = (byTitle.get(title(oldNote.titulo)) || []).filter((index) => !used.has(index));
    const index = urls[0] ?? (titles.length === 1 ? titles[0] : undefined);
    if (index === undefined) onlyV3.push(oldNote);
    else {
      used.add(index);
      matches.push({ method: urls.length ? 'url' : 'titulo', v3: oldNote, v4: newNotes[index] });
    }
  }
  const onlyV4 = newNotes.filter((_, index) => !used.has(index));
  const report = {
    fecha: '2026-09-09',
    v3: { ejecucion: 202822, notas: oldNotes.length, por_seccion: perSection(oldNotes) },
    v4: { ejecucion: 6574, notas: newNotes.length, por_seccion: perSection(newNotes) },
    coincidencias: { total: matches.length, por_url: matches.filter((row) => row.method === 'url').length, por_titulo: matches.filter((row) => row.method === 'titulo').length },
    solo_v3: onlyV3.map((note) => ({ seccion: note.seccion, medio: note.medio, titulo: note.titulo, url: note.url })),
    solo_v4: onlyV4.map((note) => ({ seccion: note.seccion, medio: note.medio, titulo: note.titulo, url: note.url })),
  };
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
