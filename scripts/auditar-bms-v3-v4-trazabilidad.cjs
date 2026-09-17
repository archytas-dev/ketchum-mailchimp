const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
function conn(name) {
  const env = config.mcpServers?.[name]?.env;
  if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error(`Falta ${name}.`);
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}
const accessToken = fs.readFileSync('.env.mgmt', 'utf8').split(/\r?\n/)
  .find((line) => line.startsWith('SUPABASE_ACCESS_TOKEN='))?.split('=').slice(1).join('=').trim();
const project = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
const runId = process.argv.find((arg) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(arg)) ||
  'b85d4d7f-273a-4a6f-bf78-1b3ea6883488';

async function getExecution(connection, id) {
  const response = await fetch(`${connection.base}/api/v1/executions/${id}?includeData=true`, { headers: connection.headers });
  if (!response.ok) throw new Error(`n8n ${id}: HTTP ${response.status}`);
  return response.json();
}

function one(data, name) {
  return data?.[name]?.at(-1)?.data?.main?.[0]?.[0]?.json || {};
}

function clean(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function decode(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function unwrap(value) {
  let current = decode(value).trim();
  for (let i = 0; i < 4; i += 1) {
    try {
      const parsed = new URL(current);
      const target = ['url', 'q', 'u', 'redirect'].map((key) => parsed.searchParams.get(key)).find(Boolean);
      if (target) {
        current = decodeURIComponent(target);
        continue;
      }
      const token = parsed.hostname === 'news.google.com' &&
        parsed.pathname.match(/\/(?:rss\/)?articles\/([A-Za-z0-9_-]{16,})/)?.[1];
      if (token) {
        const bytes = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - token.length % 4) % 4), 'base64').toString('latin1');
        const direct = bytes.match(/https?:\/\/[^\s"<>\\]+/)?.[0];
        if (direct) {
          current = direct;
          continue;
        }
      }
      break;
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
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function host(value) {
  try { return new URL(unwrap(value)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function anchors(html) {
  const out = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const item = { url: match[1], titulo: clean(match[2]) };
    if (!item.titulo || item.titulo.length < 12 || /unsubscribe|view this email|twitter|facebook|linkedin|ketchum/i.test(item.titulo)) continue;
    out.push(item);
  }
  return [...new Map(out.map((item) => [canonUrl(item.url) + '|' + normTitle(item.titulo), item])).values()];
}

function sqlText(value) { return `'${String(value ?? '').replace(/'/g, "''")}'`; }
function sqlUuidList(values) { return values.length ? values.map(sqlText).join(',') : "null"; }

async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${body.slice(0, 2000)}`);
  return JSON.parse(body);
}

function match(v3, v4) {
  const byUrl = new Map();
  const byTitle = new Map();
  for (const note of v4) {
    byUrl.set(canonUrl(note.url), [...(byUrl.get(canonUrl(note.url)) || []), note]);
    byTitle.set(normTitle(note.titulo), [...(byTitle.get(normTitle(note.titulo)) || []), note]);
  }
  return v3.map((note) => ({
    ...note,
    v4Mail: (byUrl.get(canonUrl(note.url))?.[0]) ||
      (byTitle.get(normTitle(note.titulo))?.length === 1 ? byTitle.get(normTitle(note.titulo))[0] : null),
  }));
}

(async () => {
  const [v3Execution, v4Execution] = await Promise.all([
    getExecution(conn('archytas-n8n'), '209769'),
    getExecution(conn('ketchum-n8n'), '33476'),
  ]);
  const v3RunData = v3Execution.data?.resultData?.runData || {};
  const v4RunData = v4Execution.data?.resultData?.runData || {};
  const v3Html = String(one(v3RunData, 'Build HTML Email').html || '');
  const v4Html = String(one(v4RunData, 'Preparar email v3 de prueba').html || '');
  const v3 = anchors(v3Html);
  const v4 = anchors(v4Html);
  const trazas = match(v3, v4);
  const pendientes = trazas.filter((x) => !x.v4Mail);
  const urls = [...new Set(pendientes.map((x) => canonUrl(x.url)).filter(Boolean))];
  const titles = [...new Set(pendientes.map((x) => String(x.titulo || '').toLowerCase()).filter(Boolean))];

  const raw = await sql(`
    select c.id, c.fecha, c.capturado_at, c.dominio_norm, c.fuente_id, c.fetch_log_id,
           c.url, c.url_canonica, c.titulo, c.snippet, c.fecha_pub, c.fecha_confiable,
           c.alerta_id, mf.seccion as fuente_seccion, mf.formato,
           fl.ts as fetch_ts, fl.diagnostico, fl.http_status,
           ms.tier, ms.prioritario, m.tipo as medio_tipo, m.nombre as medio_nombre
    from public.candidatas_raw c
    left join public.medios_fuentes mf on mf.id = c.fuente_id
    left join public.fetch_log fl on fl.id = c.fetch_log_id
    left join public.medios_suscripcion ms
      on ms.client_id = ${sqlText('99a7b1e3-2b24-4364-a055-be338bfff34a')}::uuid
     and ms.fuente_id = c.fuente_id
    left join public.medios m
      on m.client_id = ${sqlText('99a7b1e3-2b24-4364-a055-be338bfff34a')}::uuid
     and lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) = c.dominio_norm
    where c.fecha between date '2026-09-10' and date '2026-09-11'
      and (c.url_canonica in (${urls.map(sqlText).join(',') || 'null'}))
    order by c.capturado_at desc
  `);
  const rawIds = [...new Set(raw.map((row) => row.id))];
  const staged = rawIds.length ? await sql(`
    select pc.candidata_id, pc.orden, pc.es_prioritaria,
           cv.entra, cv.seccion, cv.confianza, cv.forzada, cv.motivo_forzada,
           cv.agente, cv.created_at as veredicto_at
    from test.v4_pipeline_run_candidatas pc
    left join test.v4_candidatas_veredicto cv
      on cv.run_id = pc.run_id and cv.candidata_id = pc.candidata_id
    where pc.run_id = ${sqlText(runId)}::uuid
      and pc.candidata_id in (${sqlUuidList(rawIds)})
    order by pc.orden
  `) : [];
  const byRawId = new Map(staged.map((row) => [row.candidata_id, row]));
  const evaluated = process.argv.includes('--evaluate') && rawIds.length ? await sql(`
    with ev as (
      select * from public.v4_evaluar_candidatas(
        ${sqlText('99a7b1e3-2b24-4364-a055-be338bfff34a')}::uuid,
        date '2026-09-11'
      ) where candidata_id in (${sqlUuidList(rawIds)})
    ), rapida as (
      select candidata_id from public.v4_candidatas_aceptadas_rapido(
        ${sqlText('99a7b1e3-2b24-4364-a055-be338bfff34a')}::uuid,
        date '2026-09-11', false
      ) where candidata_id in (${sqlUuidList(rawIds)})
    ), operativa as (
      select candidata_id from public.v4_candidatas_aceptadas_operativo(
        ${sqlText('99a7b1e3-2b24-4364-a055-be338bfff34a')}::uuid,
        date '2026-09-11', false
      ) where candidata_id in (${sqlUuidList(rawIds)})
    )
    select c.id,
           ev.descartada_por, ev.motivo, ev.valor_que_matcheo, ev.es_prioritaria,
           (rapida.candidata_id is not null) as pasa_rapida_actual,
           (operativa.candidata_id is not null) as pasa_operativa_actual
    from public.candidatas_raw c
    left join ev on ev.candidata_id = c.id
    left join rapida on rapida.candidata_id = c.id
    left join operativa on operativa.candidata_id = c.id
    where c.id in (${sqlUuidList(rawIds)})
  `) : [];
  const byEvaluatedId = new Map(evaluated.map((row) => [row.id, row]));

  const detalle = pendientes.map((note) => {
    const url = canonUrl(note.url);
    const title = normTitle(note.titulo);
    const rows = raw.filter((row) => row.url_canonica === url || normTitle(row.titulo) === title);
    const withStage = rows.map((row) => ({ ...row, stage: byRawId.get(row.id) || null }));
    let estado = 'no_aparece_en_candidatas_raw';
    if (withStage.some((row) => row.stage?.entra === true)) estado = 'aceptada_por_A2_no_aparece_en_mail';
    else if (withStage.some((row) => row.stage && row.stage.entra === false)) estado = 'entro_al_pool_descartada_por_A2';
    else if (withStage.some((row) => row.stage && row.stage.entra == null)) estado = 'entro_al_pool_sin_veredicto';
    else if (withStage.length) estado = 'esta_en_raw_pero_fuera_del_pool';
    return {
      titulo_v3: note.titulo,
      dominio_v3: host(note.url),
      url_v3: note.url,
      estado,
      candidatas: withStage.map((row) => ({
        id: row.id,
        dominio: row.dominio_norm,
        medio_tipo: row.medio_tipo,
        tier: row.tier,
        fecha: row.fecha,
        capturado_at: row.capturado_at,
        fecha_pub: row.fecha_pub,
        fecha_confiable: row.fecha_confiable,
        titulo_raw: row.titulo,
        tiene_snippet: Boolean(row.snippet && String(row.snippet).trim()),
        evaluacion_actual: byEvaluatedId.get(row.id) && {
          veredicto: byEvaluatedId.get(row.id).descartada_por,
          motivo: byEvaluatedId.get(row.id).motivo,
          valor_que_matcheo: byEvaluatedId.get(row.id).valor_que_matcheo,
          pasa_rapida: byEvaluatedId.get(row.id).pasa_rapida_actual,
          pasa_operativa: byEvaluatedId.get(row.id).pasa_operativa_actual,
        },
        stage: row.stage && {
          orden: row.stage.orden,
          es_prioritaria: row.stage.es_prioritaria,
          entra: row.stage.entra,
          seccion: row.stage.seccion,
          confianza: row.stage.confianza,
          forzada: row.stage.forzada,
          agente: row.stage.agente,
        },
      })),
    };
  });
  const counts = trazas.reduce((acc, note) => {
    const key = note.v4Mail ? 'en_mail_v4' : (detalle.find((x) => x.url_v3 === note.url)?.estado || 'sin_clasificar');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const byDomain = detalle.reduce((acc, item) => {
    const key = `${item.dominio_v3} | ${item.estado}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  if (process.argv.includes('--stats')) {
    const reasonCounts = {};
    const examples = {};
    for (const item of detalle) {
      const key = item.estado;
      for (const row of item.candidatas) {
        const reason = row.evaluacion_actual?.veredicto ||
          row.stage?.agente ||
          (item.estado === 'esta_en_raw_pero_fuera_del_pool' ? 'fuera_del_snapshot' : 'sin_evaluacion');
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        examples[reason] ||= { titulo: item.titulo_v3, dominio: item.dominio_v3, id: row.id };
      }
      if (!examples[key]) examples[key] = { titulo: item.titulo_v3, dominio: item.dominio_v3 };
    }
    console.log(JSON.stringify({
      ejecuciones: { v3: '209769', v4: '33476', v4_run_id: runId },
      cantidades: { v3_mail: v3.length, v4_mail: v4.length, coincidencias_v4: counts.en_mail_v4 || 0, v3_no_en_v4: pendientes.length },
      donde_se_perdieron: counts,
      por_dominio: Object.entries(byDomain).sort((a, b) => b[1] - a[1]),
      razones_en_raw: reasonCounts,
      ejemplos_por_razon: examples,
    }, null, 2));
    return;
  }

  if (process.argv.includes('--digest')) {
    const short = detalle.map((item) => ({
      titulo: item.titulo_v3,
      dominio: item.dominio_v3,
      estado: item.estado,
      candidatas: item.candidatas.map((row) => ({
        id: row.id,
        fecha: row.fecha,
        fecha_pub: row.fecha_pub,
        medio_tipo: row.medio_tipo,
        tier: row.tier,
        evaluacion: row.evaluacion_actual && {
          descartada_por: row.evaluacion_actual.veredicto,
          motivo: row.evaluacion_actual.motivo,
          pasa_rapida: row.evaluacion_actual.pasa_rapida,
          pasa_operativa: row.evaluacion_actual.pasa_operativa,
        },
        snapshot: row.stage && {
          entra: row.stage.entra,
          seccion: row.stage.seccion,
          confianza: row.stage.confianza,
          agente: row.stage.agente,
        },
      })),
    }));
    console.log(JSON.stringify({
      ejecuciones: { v3: '209769', v4: '33476', v4_run_id: runId },
      cantidades: { v3_mail: v3.length, v4_mail: v4.length, coincidencias_v4: counts.en_mail_v4 || 0, v3_no_en_v4: pendientes.length },
      donde_se_perdieron: counts,
      por_dominio: Object.entries(byDomain).sort((a, b) => b[1] - a[1]),
      detalle: short,
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ejecuciones: { v3: '209769', v4: '33476', v4_run_id: runId },
    cantidades: { v3_mail: v3.length, v4_mail: v4.length, coincidencias_v4: counts.en_mail_v4 || 0, v3_no_en_v4: pendientes.length },
    donde_se_perdieron: counts,
    por_dominio: Object.entries(byDomain).sort((a, b) => b[1] - a[1]),
    detalle: process.argv.includes('--compact') ? detalle.map((item) => ({
      titulo_v3: item.titulo_v3,
      dominio_v3: item.dominio_v3,
      estado: item.estado,
      candidatas: item.candidatas.map((row) => ({
        id: row.id,
        fecha: row.fecha,
        capturado_at: row.capturado_at,
        fecha_pub: row.fecha_pub,
        titulo_raw: row.titulo_raw,
        medio_tipo: row.medio_tipo,
        tier: row.tier,
        evaluacion_actual: row.evaluacion_actual,
        stage: row.stage,
      })),
    })) : detalle,
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
