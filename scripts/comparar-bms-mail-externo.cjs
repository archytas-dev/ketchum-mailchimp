const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };

function decodeQuotedPrintable(raw) {
  const compact = String(raw).replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < compact.length; i += 1) {
    if (compact[i] === '=' && /^[0-9a-f]{2}$/i.test(compact.slice(i + 1, i + 3))) {
      bytes.push(parseInt(compact.slice(i + 1, i + 3), 16)); i += 2;
    } else {
      const b = Buffer.from(compact[i], 'latin1');
      for (const x of b) bytes.push(x);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}
function normTitle(value) {
  return stripHtml(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function anchors(html) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = stripHtml(m[2]);
    if (title.length < 12 || /unsubscribe|view this email|twitter|facebook|linkedin|ketchum/i.test(title)) continue;
    out.push({ url: m[1], title });
  }
  return [...new Map(out.map(x => [normTitle(x.title), x])).values()];
}
async function execution(id) {
  const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
  if (!response.ok) throw new Error(`n8n ${id}: HTTP ${response.status}`);
  return response.json();
}
(async () => {
  const externalRaw = fs.readFileSync('C:\\Users\\Usuario\\Downloads\\Clipping Bristol Squibb Myers 11_09_2026.eml', 'utf8');
  const externalHtml = decodeQuotedPrintable(externalRaw);
  const external = anchors(externalHtml);
  const v4ExecutionId = process.argv[2] || '30679';
  const e = await execution(v4ExecutionId);
  const data = e.data?.resultData?.runData || {};
  const rows = data['Preparar email v3 de prueba']?.at(-1)?.data?.main?.[0]?.[0]?.json
    || data['Guarda dura: modo']?.at(-1)?.data?.main?.[0]?.[0]?.json || {};
  const v4 = anchors(rows.html || '');
  const ext = new Map(external.map(x => [normTitle(x.title), x]));
  const v4Map = new Map(v4.map(x => [normTitle(x.title), x]));
  const common = [...v4Map.keys()].filter(k => ext.has(k));
  console.log(JSON.stringify({
    externo: { notas: external.length, con_formato_ejemplo: /Alcance:\s*14\.000\s+Tier:1[\s\S]*Ad Value:/i.test(externalHtml) },
    v4: { ejecucion: v4ExecutionId, notas: v4.length },
    mismos_titulos: common.length,
    ejemplos_comunes: common.slice(0, 10).map(k => v4Map.get(k).title),
    solo_externo: [...ext.values()].filter(x => !v4Map.has(normTitle(x.title))).slice(0, 12),
    solo_v4: [...v4.values()].filter(x => !ext.has(normTitle(x.title))).slice(0, 12),
  }, null, 2));
})().catch(error => { console.error(error.stack || error.message, error.cause || ''); process.exit(1); });
