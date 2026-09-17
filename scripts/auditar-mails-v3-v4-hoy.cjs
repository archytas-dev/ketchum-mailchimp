const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));

function connection(name) {
  const env = config.mcpServers?.[name]?.env;
  if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error(`Falta ${name}.`);
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}

const v3 = connection('archytas-n8n');
const v4 = connection('ketchum-n8n');
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const clients = {
  bms: { label: 'BMS', clientId: '99a7b1e3-2b24-4364-a055-be338bfff34a', v3: ['hLi9wQAgZ0Z5HlSe', 'bgabQ3ICjdex0ppC'] },
  booking: { label: 'Booking', clientId: '65170cb4-0646-4602-b5b5-f1b93e6762d4', v3: ['fmSygwIDbpxm8Ubq', 'Km1e6ZWLYEl9hQRV'] },
  mars: { label: 'Mars', clientId: '145311f2-79a0-430b-b528-c9683d1e196f', v3: ['nXD0RHy6q69cTrT2', 'VwGjBYNQvi51ZhR7'] },
  msd: { label: 'MSD', clientId: '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026', v3: ['19NPw3POuwTKdUsK', 'gXXA9qIJ844k6OUs'] },
};

async function get(conn, path) {
  const response = await fetch(`${conn.base}${path}`, { headers: conn.headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function listToday(conn, workflowId) {
  const page = await get(conn, `/api/v1/executions?workflowId=${workflowId}&limit=20`);
  return (page.data || []).filter((e) => String(e.startedAt || '').startsWith(today));
}

async function detail(conn, id) {
  return get(conn, `/api/v1/executions/${id}?includeData=true`);
}

function one(data, names) {
  for (const name of names) {
    const rows = data?.[name];
    if (rows?.length) return rows.at(-1)?.data?.main?.[0]?.[0]?.json || null;
  }
  return null;
}

function clean(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function unwrap(value) {
  let current = clean(value);
  for (let i = 0; i < 3; i += 1) {
    try {
      const parsed = new URL(current);
      const target = ['url', 'q', 'u', 'redirect'].map((key) => parsed.searchParams.get(key)).find(Boolean);
      if (!target) break;
      current = decodeURIComponent(target);
    } catch { break; }
  }
  return current;
}

function canonUrl(value) {
  try {
    const parsed = new URL(unwrap(value));
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|mc_|ref$)/i.test(key)) parsed.searchParams.delete(key);
    parsed.hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch { return unwrap(value).toLowerCase().replace(/\/+$/, ''); }
}

function title(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function fieldCounts(rows) {
  const filled = (key) => rows.filter((row) => row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== '').length;
  return { tier: filled('tier'), alcance: filled('alcance'), ad_value: filled('ad_value') };
}

function domainCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    let domain = row.dominio || '';
    try { domain = new URL(unwrap(row.url)).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
    counts.set(domain || '(sin dominio)', (counts.get(domain || '(sin dominio)') || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function links(html) {
  const ignored = /(?:mcusercontent|mailchimp|cdn-images|ketchum\.com|twitter\.com|facebook\.com|google\.com\/maps|mailto:)/i;
  const seen = new Set();
  const out = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = url(match[1]);
    const text = clean(match[2]);
    if (!href || ignored.test(href) || !text || seen.has(href)) continue;
    seen.add(href); out.push({ url: href, titulo: text });
  }
  return out;
}

function metadata(html) {
  const source = String(html || '');
  return {
    tier: (source.match(/Tier\s*:/gi) || []).length,
    alcance: (source.match(/Alcance\s*:/gi) || []).length,
    ad_value: (source.match(/Ad\.?\s*Value\s*:/gi) || []).length,
  };
}

async function chooseV3(entry) {
  const pages = await Promise.all(entry.v3.map((id) => listToday(v3, id)));
  const candidates = pages.flat().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  for (const candidate of candidates) {
    const full = await detail(v3, candidate.id);
    const data = full.data?.resultData?.runData || {};
    const email = one(data, ['Build HTML Email']);
    const html = email?.html || '';
    const prepared = one(data, ['Prep Supabase Rows']);
    const notes = (prepared?.notes || []).map((row) => ({ ...row, titulo: row.titulo || row.title }));
    const htmlTitle = title(html);
    const rendered = notes.filter((row) => {
      const rowTitle = title(row.titulo);
      return rowTitle && htmlTitle.includes(rowTitle);
    });
    if (notes.length) return { id: candidate.id, status: full.status, startedAt: full.startedAt, stoppedAt: full.stoppedAt, html, notes: rendered.length ? rendered : notes, metadata: fieldCounts(rendered.length ? rendered : notes) };
  }
  return null;
}

async function chooseV4(entry) {
  if (entry.v4) {
    const full = await detail(v4, entry.v4);
    const data = full.data?.resultData?.runData || {};
    const cfg = one(data, ['Config']);
    const email = one(data, ['Preparar email v3 de prueba', 'Preparar email BMS de prueba']);
    const clipping = one(data, ['Armar clipping para email de prueba', 'Armar clipping BMS para email de prueba']);
    const notes = (clipping?.secciones || []).flatMap((section) => (section.notas || []).map((row) => ({ ...row, seccion: section.nombre, titulo: row.titulo || row.title })));
    return { id: entry.v4, status: full.status, startedAt: full.startedAt, stoppedAt: full.stoppedAt, modo: cfg?.modo || null, emailPara: email?.para || null, html: email?.html || '', notes, metadata: fieldCounts(notes), lastNode: full.data?.resultData?.lastNodeExecuted || null, error: full.data?.resultData?.error?.message || null };
  }
  const list = await get(v4, '/api/v1/executions?workflowId=ORrmePsGxJJxISTo&limit=100');
  const todayRows = (list.data || []).filter((e) => String(e.startedAt || '').startsWith(today));
  const matches = [];
  for (const candidate of todayRows) {
    const full = await detail(v4, candidate.id);
    const data = full.data?.resultData?.runData || {};
    const cfg = one(data, ['Config']);
    if (cfg?.client_id !== entry.clientId) continue;
    const email = one(data, ['Preparar email v3 de prueba', 'Preparar email BMS de prueba']);
    const clipping = one(data, ['Armar clipping para email de prueba', 'Armar clipping BMS para email de prueba']);
    const html = email?.html || '';
    const notes = (clipping?.secciones || []).flatMap((section) => (section.notas || []).map((row) => ({ ...row, seccion: section.nombre, titulo: row.titulo || row.title })));
    matches.push({ id: candidate.id, status: full.status, startedAt: full.startedAt, stoppedAt: full.stoppedAt, modo: cfg?.modo || null, emailPara: email?.para || null, html, notes, metadata: fieldCounts(notes), lastNode: full.data?.resultData?.lastNodeExecuted || null, error: full.data?.resultData?.error?.message || null });
  }
  return matches.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).find((row) => row.notes.length || row.status !== 'success') || matches[0] || null;
}

function compare(oldRow, newRow) {
  const oldNotes = oldRow?.notes || [];
  const newNotes = newRow?.notes || [];
  const oldByUrl = new Map(oldNotes.map((x) => [canonUrl(x.url), x]));
  const newByUrl = new Map(newNotes.map((x) => [canonUrl(x.url), x]));
  const oldByTitle = new Map(oldNotes.map((x) => [title(x.titulo), x]));
  const newByTitle = new Map(newNotes.map((x) => [title(x.titulo), x]));
  return {
    v3: oldRow && { ejecucion: oldRow.id, estado: oldRow.status, inicio: oldRow.startedAt, fin: oldRow.stoppedAt, notas: oldNotes.length, html_bytes: oldRow.html.length, metadata: oldRow.metadata },
    v4: newRow && { ejecucion: newRow.id, estado: newRow.status, modo: newRow.modo, para: newRow.emailPara, inicio: newRow.startedAt, fin: newRow.stoppedAt, notas: newNotes.length, html_bytes: newRow.html.length, metadata: newRow.metadata, ultimo_nodo: newRow.lastNode, error: newRow.error },
    comunes_url: [...newByUrl.keys()].filter((key) => oldByUrl.has(key)).length,
    comunes_titulo: [...newByTitle.keys()].filter((key) => oldByTitle.has(key)).length,
    solo_v3: oldNotes.filter((x) => !newByUrl.has(canonUrl(x.url)) && !newByTitle.has(title(x.titulo))).slice(0, 12),
    solo_v4: newNotes.filter((x) => !oldByUrl.has(canonUrl(x.url)) && !oldByTitle.has(title(x.titulo))).slice(0, 12),
    titulos_v4: newNotes.slice(0, 5),
  };
}

(async () => {
  const report = {};
  const requested = process.argv.find((arg) => arg.startsWith('--client='))?.split('=')[1];
  for (const [slug, entry] of Object.entries(clients).filter(([name]) => !requested || name === requested)) {
    const [oldRow, newRow] = await Promise.all([chooseV3(entry), chooseV4(entry)]);
    report[slug] = compare(oldRow, newRow);
  }
  if (process.argv.includes('--compact')) {
    const compact = Object.fromEntries(Object.entries(report).map(([slug, value]) => [slug, {
      v3: value.v3 && { ejecucion: value.v3.ejecucion, inicio: value.v3.inicio, fin: value.v3.fin, notas: value.v3.notas, metadata: value.v3.metadata },
      v4: value.v4 && { ejecucion: value.v4.ejecucion, inicio: value.v4.inicio, fin: value.v4.fin, notas: value.v4.notas, metadata: value.v4.metadata, modo: value.v4.modo, para: value.v4.para, ultimo_nodo: value.v4.ultimo_nodo, error: value.v4.error },
      comunes_url: value.comunes_url,
      comunes_titulo: value.comunes_titulo,
      solo_v3: value.solo_v3.map((row) => ({ medio: row.medio, titulo: row.titulo, url: row.url })),
      solo_v4: value.solo_v4.map((row) => ({ medio: row.medio, titulo: row.titulo, url: row.url })),
    }]));
    console.log(JSON.stringify({ fecha: today, report: compact }, null, 2));
    return;
  }
  console.log(JSON.stringify({ fecha: today, report }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
