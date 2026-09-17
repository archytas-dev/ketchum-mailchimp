const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
function conn(name) {
  const env = config.mcpServers?.[name]?.env;
  if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error(`Falta ${name}`);
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}
async function get(c, id) {
  const response = await fetch(`${c.base}/api/v1/executions/${id}?includeData=true`, { headers: c.headers });
  if (!response.ok) throw new Error(`Ejecucion ${id}: HTTP ${response.status}`);
  return response.json();
}
function one(data, names) {
  for (const name of names) if (data?.[name]?.length) return data[name].at(-1)?.data?.main?.[0]?.[0]?.json || null;
  return null;
}
function clean(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function norm(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function unwrap(value) {
  let current = clean(value);
  for (let i = 0; i < 4; i += 1) {
    try {
      const u = new URL(current);
      const target = ['url', 'q', 'u', 'redirect'].map((key) => u.searchParams.get(key)).find(Boolean);
      if (target) { current = decodeURIComponent(target); continue; }
      if (u.hostname === 'news.google.com') {
        const token = u.pathname.match(/\/(?:rss\/)?articles\/([A-Za-z0-9_-]{16,})/)?.[1];
        if (token) {
          const raw = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - token.length % 4) % 4), 'base64').toString('latin1');
          const direct = raw.match(/https?:\/\/[^\s"<>\\]+/)?.[0];
          if (direct) { current = direct; continue; }
        }
      }
      break;
    } catch { break; }
  }
  return current;
}
function canon(value) {
  try {
    const u = new URL(unwrap(value));
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|mc_|ref)/i.test(key)) u.searchParams.delete(key);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return u.toString();
  } catch { return clean(value).toLowerCase().replace(/\/$/, ''); }
}
function sectionCounts(rows, key) {
  return Object.fromEntries([...rows.reduce((map, row) => {
    const value = row[key] || '(sin seccion)';
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1]));
}
function keepRendered(rows, html) {
  const text = norm(html);
  return rows.filter((row) => {
    const t = norm(row.titulo);
    return t && text.includes(t);
  });
}
function unique(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = canon(row.url) || norm(row.titulo);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function compare(v3, v4) {
  const byUrl = new Map();
  const byTitle = new Map();
  for (const row of v4) {
    byUrl.set(canon(row.url), [...(byUrl.get(canon(row.url)) || []), row]);
    byTitle.set(norm(row.titulo), [...(byTitle.get(norm(row.titulo)) || []), row]);
  }
  const matched = [];
  const onlyV3 = [];
  const used = new Set();
  for (const row of v3) {
    const candidates = (byUrl.get(canon(row.url)) || []).filter((x) => !used.has(x));
    const titleCandidates = (byTitle.get(norm(row.titulo)) || []).filter((x) => !used.has(x));
    const hit = candidates[0] || (titleCandidates.length === 1 ? titleCandidates[0] : null);
    if (hit) { used.add(hit); matched.push({ titulo: row.titulo, v3_seccion: row.seccion, v4_seccion: hit.seccion }); }
    else onlyV3.push(row);
  }
  return {
    v3_total: v3.length,
    v4_total: v4.length,
    comunes: matched.length,
    solo_v3: onlyV3,
    solo_v4: v4.filter((row) => !used.has(row)),
    cambios_seccion: matched.filter((row) => row.v3_seccion !== row.v4_seccion),
    secciones_v3: sectionCounts(v3, 'seccion'),
    secciones_v4: sectionCounts(v4, 'seccion'),
  };
}

(async () => {
  const v4ExecutionId = process.argv[2] || '38944';
  const [oldExecution, newExecution] = await Promise.all([
    get(conn('archytas-n8n'), '212241'),
    get(conn('ketchum-n8n'), v4ExecutionId),
  ]);
  const oldData = oldExecution.data?.resultData?.runData || {};
  const newData = newExecution.data?.resultData?.runData || {};
  const oldEmail = one(oldData, ['Build HTML Email']) || {};
  const newEmail = one(newData, ['Preparar email v3 de prueba']) || {};
  const oldPrep = one(oldData, ['Prep Supabase Rows']) || {};
  const newClipping = one(newData, ['Armar clipping para email de prueba']) || {};
  const v3 = unique(keepRendered((oldPrep.notes || []).map((row) => ({
    titulo: row.titulo || row.title,
    url: row.url,
    medio: row.medio,
    seccion: row.grupo || row.seccion || row.categoria || '(sin seccion)',
  })), oldEmail.html || ''));
  const v4 = unique(keepRendered((newClipping.secciones || []).flatMap((section) => (section.notas || []).map((row) => ({
    titulo: row.titulo || row.title,
    url: row.url,
    medio: row.medio,
    seccion: section.nombre,
  }))), newEmail.html || ''));
  console.log(JSON.stringify({
    ejecuciones: { v3: '212241', v4: v4ExecutionId },
    estados: { v3: oldExecution.status, v4: newExecution.status },
    comparacion: compare(v3, v4),
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
