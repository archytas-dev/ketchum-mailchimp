const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const mgmt = fs.readFileSync('.env.mgmt', 'utf8').split(/\r?\n/).find((line) => line.startsWith('SUPABASE_ACCESS_TOKEN='))?.split('=').slice(1).join('=').trim();
const project = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();

function conn(name) {
  const env = config.mcpServers?.[name]?.env;
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}
const v3 = conn('archytas-n8n');
const v4 = conn('ketchum-n8n');
const clients = {
  bms: { v3: '212241', v4: '42788', run: 'a601f704-28c6-4ab6-8fa2-cd1a28638a9e' },
  booking: { v3: '212248', v4: '37454', run: 'd2bb2ae4-67ce-4e3f-9a01-1a61a049d7c4' },
  mars: { v3: '212237', v4: '36711', run: '6bbcd41e-cf6c-4c8a-afb9-123865f30717' },
  msd: { v3: '212254', v4: '37491', run: 'e78f7b0a-b94b-4cc2-9fb6-d38329ae7da6' },
};

async function get(c, id) {
  const response = await fetch(`${c.base}/api/v1/executions/${id}?includeData=true`, { headers: c.headers });
  if (!response.ok) throw new Error(`n8n ${id}: HTTP ${response.status}`);
  return response.json();
}
async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgmt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase: HTTP ${response.status}: ${body.slice(0, 1200)}`);
  return JSON.parse(body);
}
function one(data, names) {
  for (const name of names) if (data?.[name]?.length) return data[name].at(-1)?.data?.main?.[0]?.[0]?.json || null;
  return null;
}
function clean(value) { return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function unwrap(value) {
  let current = clean(value);
  for (let i = 0; i < 4; i += 1) {
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
function dbCanonUrl(value) {
  try {
    const parsed = new URL(unwrap(value));
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|mc_|ref$)/i.test(key)) parsed.searchParams.delete(key);
    parsed.hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch { return unwrap(value).toLowerCase().replace(/\/+$/, ''); }
}
function normTitle(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function host(value) { try { return new URL(unwrap(value)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function sqlText(value) { return `'${String(value ?? '').replace(/'/g, "''")}'`; }
function sqlList(values) { return values.length ? values.map(sqlText).join(',') : 'null'; }
function notesFromV3(data) {
  const prepared = one(data, ['Prep Supabase Rows']);
  const notes = (prepared?.notes || []).map((row) => ({ ...row, titulo: row.titulo || row.title }));
  const email = one(data, ['Build HTML Email']);
  const htmlTitle = normTitle(email?.html || '');
  return notes.filter((row) => {
    const t = normTitle(row.titulo);
    return t && htmlTitle.includes(t);
  });
}
function notesFromV4(data) {
  const clipping = one(data, ['Armar clipping para email de prueba', 'Armar clipping BMS para email de prueba']);
  return (clipping?.secciones || []).flatMap((section) => (section.notas || []).map((row) => ({ ...row, seccion: section.nombre, titulo: row.titulo || row.title })));
}
function match(v3Notes, v4Notes) {
  const urls = new Set(v4Notes.map((row) => canonUrl(row.url)));
  const titles = new Set(v4Notes.map((row) => normTitle(row.titulo)));
  return v3Notes.filter((row) => !urls.has(canonUrl(row.url)) && !titles.has(normTitle(row.titulo)));
}

(async () => {
  const report = {};
  const requested = process.argv.find((arg) => arg.startsWith('--client='))?.split('=')[1];
  for (const [slug, ids] of Object.entries(clients).filter(([name]) => !requested || name === requested)) {
    const [oldExecution, newExecution] = await Promise.all([get(v3, ids.v3), get(v4, ids.v4)]);
    const oldNotes = notesFromV3(oldExecution.data?.resultData?.runData || {});
    const newNotes = notesFromV4(newExecution.data?.resultData?.runData || {});
    const onlyV3 = match(oldNotes, newNotes);
    const urls = [...new Set(onlyV3.map((row) => dbCanonUrl(row.url)).filter(Boolean))];
    const titles = [...new Set(onlyV3.map((row) => normTitle(row.titulo)).filter(Boolean))];
    const raw = onlyV3.length ? await sql(`
      select c.id, c.url, c.url_canonica, c.titulo, c.dominio_norm, c.fecha, c.capturado_at,
             c.fecha_pub, c.fecha_confiable, c.fuente_id, fl.ts as fetch_ts, fl.diagnostico,
             fl.http_status, mf.seccion as fuente_seccion,
             pc.orden, pc.es_prioritaria, cv.entra, cv.seccion as veredicto_seccion,
             cv.confianza, cv.forzada, cv.motivo_forzada, cv.agente
      from public.candidatas_raw c
      left join public.fetch_log fl on fl.id = c.fetch_log_id
      left join public.medios_fuentes mf on mf.id = c.fuente_id
      left join test.v4_pipeline_run_candidatas pc
        on pc.candidata_id = c.id and pc.run_id = ${sqlText(ids.run)}::uuid
      left join test.v4_candidatas_veredicto cv
        on cv.candidata_id = c.id and cv.run_id = ${sqlText(ids.run)}::uuid
      where (c.url_canonica in (${sqlList(urls)}) or lower(c.titulo) in (${sqlList(titles)}))
        and c.capturado_at >= timestamp '2026-09-13 00:00:00'
      order by c.capturado_at desc
    `) : [];
    const details = onlyV3.map((note) => {
      const rows = raw.filter((row) => row.url_canonica === dbCanonUrl(note.url) || normTitle(row.titulo) === normTitle(note.titulo));
      const withStage = rows.filter((row) => row.orden !== null || row.entra !== null);
      let motivo = 'no_aparece_en_raw';
      if (withStage.some((row) => row.entra === true)) motivo = 'paso_A2_pero_no_llego_al_mail';
      else if (withStage.some((row) => row.entra === false)) motivo = 'llego_a_A2_y_fue_descartada';
      else if (rows.length) motivo = 'esta_en_raw_pero_no_entro_a_esta_corrida';
      return {
        medio: note.medio,
        titulo: note.titulo,
        dominio: host(note.url),
        motivo,
        candidatas: rows.map((row) => ({ id: row.id, titulo_raw: row.titulo, capturado_at: row.capturado_at, fecha_pub: row.fecha_pub, fetch: row.fetch_ts ? { ts: row.fetch_ts, diagnostico: row.diagnostico, http: row.http_status } : null, etapa: row.orden === null && row.entra === null ? null : { orden: row.orden, entra: row.entra, seccion: row.veredicto_seccion, confianza: row.confianza, forzada: row.forzada, agente: row.agente } })),
      };
    });
    const resumen = details.reduce((acc, row) => { acc[row.motivo] = (acc[row.motivo] || 0) + 1; return acc; }, {});
    const porMedio = details.reduce((acc, row) => { const key = `${row.medio || row.dominio} | ${row.motivo}`; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
    report[slug] = { v3_mail: oldNotes.length, v4_mail: newNotes.length, solo_v3: onlyV3.length, resumen, por_medio: Object.entries(porMedio).sort((a, b) => b[1] - a[1]), ejemplos: details.slice(0, 10), ...(process.argv.includes('--details') ? { detalles: details } : {}) };
  }
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
