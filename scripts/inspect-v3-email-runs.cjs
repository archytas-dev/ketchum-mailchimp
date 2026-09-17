const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['archytas-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
const runs = { bms: '212241', booking: '212248', mars: '212237', msd: '212254' };

function one(data, name) { return data?.[name]?.at(-1)?.data?.main?.[0]?.[0]?.json || null; }
function clean(value) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }
function norm(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function shape(value) {
  if (!value || typeof value !== 'object') return typeof value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, Array.isArray(child) ? `array:${child.length}` : (child && typeof child === 'object' ? `object:${Object.keys(child).length}` : typeof child)]));
}

(async () => {
  const out = {};
  for (const [client, id] of Object.entries(runs)) {
    const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
    if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
    const execution = await response.json();
    const data = execution.data?.resultData?.runData || {};
    const email = one(data, 'Build HTML Email');
    const prepared = one(data, 'Prep Supabase Rows');
    const html = email?.html || '';
    const htmlText = norm(html);
    const preparedNotes = prepared?.notes || [];
    const rendered = preparedNotes.filter((note) => {
      const noteTitle = norm(note.titulo || note.title);
      return noteTitle && htmlText.includes(noteTitle);
    });
    out[client] = {
      id,
      status: execution.status,
      startedAt: execution.startedAt,
      stoppedAt: execution.stoppedAt,
      email_keys: email ? Object.keys(email) : [],
      email_total_notas: email?.total_notas ?? email?.totalNotas ?? null,
      resumen_shape: shape(email?.resumen_obj),
      html_mailchimp_bytes: email?.html_mailchimp?.length || 0,
      prep_notas: preparedNotes.length,
      titulos_en_html: rendered.length,
      html_bytes: html.length,
      html_tier_labels: (html.match(/Tier\s*:/gi) || []).length,
      html_alcance_labels: (html.match(/Alcance\s*:/gi) || []).length,
      html_ad_value_labels: (html.match(/Ad\.?\s*Value\s*:/gi) || []).length,
      html_text_start: clean(html).slice(0, 220),
    };
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
