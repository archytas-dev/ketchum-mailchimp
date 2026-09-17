const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const n8n = (name) => {
  const env = config.mcpServers?.[name]?.env;
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
};
const mgmt = fs.readFileSync('.env.mgmt', 'utf8').split(/\r?\n/).find((line) => line.startsWith('SUPABASE_ACCESS_TOKEN='))?.split('=')[1]?.trim();
const project = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();

const pairs = [
  { slug: 'bms', client: '99a7b1e3-2b24-4364-a055-be338bfff34a', v3: '209769', v4: '33476' },
  { slug: 'booking', client: '65170cb4-0646-4602-b5b5-f1b93e6762d4', v3: '206155', v4: '29850' },
  { slug: 'mars', client: '145311f2-79a0-430b-b528-c9683d1e196f', v3: '206147', v4: '29903' },
  { slug: 'msd', client: '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026', v3: '206168', v4: '29838' },
];

function one(data, name) { return data?.[name]?.at(-1)?.data?.main?.[0]?.[0]?.json || null; }
async function getExecution(connection, id) {
  const response = await fetch(`${connection.base}/api/v1/executions/${id}?includeData=true`, { headers: connection.headers });
  if (!response.ok) throw new Error(`n8n ${id}: HTTP ${response.status}`);
  return response.json();
}
function decode(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
function unwrap(value) {
  let current = decode(value).trim();
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
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$|ref$|referrer$)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch { return String(value || '').toLowerCase().replace(/\/$/, ''); }
}
function normTitle(value) {
  return decode(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function host(value) {
  try { return new URL(unwrap(value)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function v4Notes(data) {
  const clipping = one(data, 'Armar clipping para email de prueba') || one(data, 'Armar clipping BMS para email de prueba');
  return (clipping?.secciones || []).flatMap((section) => (section.notas || []).map((note) => ({ ...note, __seccion: section.nombre })));
}
function sqlText(value) { return `'${String(value ?? '').replace(/'/g, "''")}'`; }
async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgmt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${body.slice(0, 2000)}`);
  return JSON.parse(body);
}
function matchNotes(v3, v4) {
  const byUrl = new Map();
  const byTitle = new Map();
  v4.forEach((note, index) => {
    const url = canonUrl(note.url);
    const title = normTitle(note.titulo);
    if (url) byUrl.set(url, [...(byUrl.get(url) || []), index]);
    if (title) byTitle.set(title, [...(byTitle.get(title) || []), index]);
  });
  const used = new Set();
  const onlyV3 = [];
  for (const note of v3) {
    const urls = (byUrl.get(canonUrl(note.url)) || []).filter((i) => !used.has(i));
    const titles = (byTitle.get(normTitle(note.titulo)) || []).filter((i) => !used.has(i));
    const index = urls[0] ?? (titles.length === 1 ? titles[0] : undefined);
    if (index === undefined) onlyV3.push(note);
    else used.add(index);
  }
  return { onlyV3 };
}
async function inspectPair(pair, v3Connection, v4Connection) {
  const [oldExecution, newExecution] = await Promise.all([
    getExecution(v3Connection, pair.v3),
    getExecution(v4Connection, pair.v4),
  ]);
  const oldData = oldExecution.data?.resultData?.runData || {};
  const newData = newExecution.data?.resultData?.runData || {};
  const v3 = one(oldData, 'Prep Supabase Rows')?.notes || [];
  const v4 = v4Notes(newData);
  const { onlyV3 } = matchNotes(v3, v4);
  const urls = [...new Set(onlyV3.map((n) => canonUrl(n.url)).filter(Boolean))];
  const titles = [...new Set(onlyV3.map((n) => normTitle(n.titulo)).filter(Boolean))];
  if (!onlyV3.length) return { slug: pair.slug, v3: v3.length, v4: v4.length, only_v3: 0, detalle: [] };
  const raw = await sql(`
    select c.id, c.fecha, c.capturado_at, c.dominio_norm, c.fuente_id, c.fetch_log_id,
           c.url, c.url_canonica, c.titulo, c.fecha_pub, c.fecha_confiable, c.alerta_id,
           mf.seccion, mf.formato, fl.ts as fetch_ts, fl.diagnostico, fl.http_status,
           fl.articulos, ga.tema as alerta_tema,
           ms.tier, ms.prioritario, m.tipo as medio_tipo, m.nombre as medio_nombre,
           h.id as historico_id, h.primera_vez_run_id
    from public.candidatas_raw c
    left join public.medios_fuentes mf on mf.id = c.fuente_id
    left join public.fetch_log fl on fl.id = c.fetch_log_id
    left join public.google_alerts ga on ga.id = c.alerta_id
    left join public.medios_suscripcion ms on ms.client_id = ${sqlText(pair.client)} and ms.fuente_id = c.fuente_id
    left join public.notas_historico_url h on h.client_id = ${sqlText(pair.client)}::uuid and h.url_norm = c.url_canonica
    left join public.medios m on m.client_id = ${sqlText(pair.client)}
      and lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) = c.dominio_norm
    where c.fecha between date '2026-09-10' and date '2026-09-11'
      and (c.url_canonica in (${urls.map(sqlText).join(',')}) or c.titulo in (${onlyV3.map((n) => sqlText(n.titulo)).join(',')}))
    order by c.capturado_at desc
  `);
  const accepted = await sql(`
    select 'rapido' as etapa, candidata_id from public.v4_candidatas_aceptadas_rapido(${sqlText(pair.client)}::uuid, date '2026-09-11', false)
    union all
    select 'operativo' as etapa, candidata_id from public.v4_candidatas_aceptadas_operativo(${sqlText(pair.client)}::uuid, date '2026-09-11', false)
  `);
  const quick = new Set(accepted.filter((row) => row.etapa === 'rapido').map((row) => row.candidata_id));
  const operative = new Set(accepted.filter((row) => row.etapa === 'operativo').map((row) => row.candidata_id));
  const detail = onlyV3.map((note) => {
    const url = canonUrl(note.url);
    const title = normTitle(note.titulo);
    const candidates = raw.filter((row) => row.url_canonica === url || normTitle(row.titulo) === title);
    const rows = candidates.map((row) => ({
      id: row.id,
      titulo_raw: row.titulo,
      dominio: row.dominio_norm,
      medio_tipo: row.medio_tipo,
      tier: row.tier,
      alerta: row.alerta_tema || null,
      historial: row.historico_id ? { id: row.historico_id, primera_vez_run_id: row.primera_vez_run_id } : null,
      fetch: row.fetch_ts ? { ts: row.fetch_ts, diagnostico: row.diagnostico, articulos: row.articulos, http: row.http_status } : null,
      fecha_pub: row.fecha_pub,
      fecha_confiable: row.fecha_confiable,
      en_pool_rapido: quick.has(row.id),
      en_pool_operativo: operative.has(row.id),
    }));
    let motivo = 'no_recolectada';
    if (rows.some((row) => row.en_pool_operativo)) motivo = 'llego_y_paso_el_filtro; se perdio despues del pool';
    else if (rows.some((row) => row.historial)) motivo = 'bloqueada_por_historial_de_nota_ya_enviada';
    else if (rows.some((row) => row.en_pool_rapido)) motivo = 'llego; la descarto el filtro duro de keyword/marca';
    else if (rows.length) motivo = 'llego a candidatas_raw; quedo fuera por ventana, fuente, fecha o historial';
    return { titulo: note.titulo, medio_v3: note.medio, dominio_v3: host(note.url), motivo, candidatas_v4: rows };
  });
  const resumen = detail.reduce((acc, row) => { acc[row.motivo] = (acc[row.motivo] || 0) + 1; return acc; }, {});
  return { slug: pair.slug, v3: v3.length, v4: v4.length, only_v3: onlyV3.length, resumen, detalle: detail };
}

(async () => {
  const [v3Connection, v4Connection] = [n8n('archytas-n8n'), n8n('ketchum-n8n')];
  const reports = [];
  const requested = process.argv.find((arg) => arg.startsWith('--client='))?.split('=')[1];
  for (const pair of pairs.filter((item) => !requested || item.slug === requested)) reports.push(await inspectPair(pair, v3Connection, v4Connection));
  if (process.argv.includes('--counts')) {
    console.log(JSON.stringify(reports.map((report) => ({
      slug: report.slug,
      v3: report.v3,
      v4: report.v4,
      only_v3: report.only_v3,
      resumen: report.resumen,
      historial: report.detalle.filter((row) => row.motivo === 'bloqueada_por_historial_de_nota_ya_enviada').length,
    })), null, 2));
  } else if (process.argv.includes('--summary')) {
    console.log(JSON.stringify(reports.map((report) => ({
      slug: report.slug,
      v3: report.v3,
      v4: report.v4,
      only_v3: report.only_v3,
      resumen: report.resumen,
      historial: report.detalle.filter((row) => row.motivo === 'bloqueada_por_historial_de_nota_ya_enviada').length,
      por_dominio: Object.entries(report.detalle.reduce((acc, row) => {
        const key = `${row.dominio_v3 || '(sin dominio)'} | ${row.motivo}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})).sort((a, b) => b[1] - a[1]),
      ejemplos: report.detalle.slice(0, 8).map((row) => ({
        titulo: row.titulo,
        dominio: row.dominio_v3,
        motivo: row.motivo,
        candidatas_v4: row.candidatas_v4.slice(0, 3),
      })),
    })), null, 2));
  } else console.log(JSON.stringify(reports, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
