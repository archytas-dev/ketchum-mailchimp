const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };
const runs = { BMS: '37404', Booking: '37454', Mars: '36711', MSD: '37491' };

async function get(id) {
  const response = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  return response.json();
}
function one(data, names) {
  for (const name of names) if (data?.[name]?.length) return data[name].at(-1)?.data?.main?.[0]?.[0]?.json || null;
  return null;
}
function text(value) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }
function host(value) { try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function description(note) { return text(note.descripcion ?? note.description ?? note.snippet ?? note.copete ?? note.resumen ?? note.bajada); }

(async () => {
  const report = {};
  const requested = String(process.argv[2] || '').toLowerCase();
  const selected = requested ? Object.entries(runs).filter(([client]) => client.toLowerCase() === requested) : Object.entries(runs);
  for (const [client, id] of selected) {
    const execution = await get(id);
    const data = execution.data?.resultData?.runData || {};
    const clipping = one(data, ['Armar clipping para email de prueba', 'Armar clipping BMS para email de prueba']);
    const sections = clipping?.secciones || [];
    const notes = sections.flatMap((section) => (section.notas || []).map((note) => ({
      seccion: section.nombre,
      medio: note.medio,
      dominio: note.dominio || host(note.url),
      titulo: note.titulo || note.title,
      fecha: note.fecha_pub,
      descripcion: description(note),
      tier: note.tier,
      alcance: note.alcance,
      ad_value: note.ad_value,
      forzada: note.forzada,
      confianza: note.confianza,
      url: note.url,
    })));
    const sectionCounts = Object.fromEntries(sections.map((section) => [section.nombre, section.cantidad ?? section.notas?.length ?? 0]));
    report[client] = {
      ejecucion: id,
      inicio: execution.startedAt,
      fin: execution.stoppedAt,
      total: notes.length,
      secciones: sectionCounts,
      sin_descripcion: notes.filter((note) => !note.descripcion).map(({ titulo, medio, seccion, url }) => ({ titulo, medio, seccion, url })),
      notas: notes,
    };
  }
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
