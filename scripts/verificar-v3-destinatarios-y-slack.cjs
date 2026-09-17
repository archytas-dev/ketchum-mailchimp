// Chequeo compacto de los 4 clippings v3 en la cuenta Archytas: a quien le manda el mail
// y si los nodos de Slack quedaron apagados. Imprime solo eso, no el workflow entero.
const fs = require('fs');
const os = require('os');
const path = require('path');

const WFS = {
  BMS: 'hLi9wQAgZ0Z5HlSe',
  Booking: 'fmSygwIDbpxm8Ubq',
  MSD: '19NPw3POuwTKdUsK',
  Mars: 'nXD0RHy6q69cTrT2',
};

const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
const env = config.mcpServers?.['archytas-n8n']?.env;
if (!env) throw new Error('No hay config de archytas-n8n en ~/.claude.json');
const base = env.N8N_API_URL.replace(/\/$/, '');

(async () => {
  for (const [nombre, id] of Object.entries(WFS)) {
    const r = await fetch(`${base}/api/v1/workflows/${id}`, {
      headers: { 'X-N8N-API-KEY': env.N8N_API_KEY },
    });
    if (!r.ok) { console.log(`${nombre}: HTTP ${r.status}`); continue; }
    const wf = await r.json();
    const nodes = (wf.activeVersion || wf).nodes || [];
    const gsid = nodes.find((n) => n.name === 'GSID');
    const dest = gsid?.parameters?.assignments?.assignments?.find((a) => a.name === 'destinatario')?.value || '(no encontrado)';
    const slack = nodes.filter((n) => n.type === 'n8n-nodes-base.slack');
    const prendidos = slack.filter((n) => !n.disabled).map((n) => n.name);
    console.log(`\n=== ${nombre} (${id}) · active=${wf.active} ===`);
    console.log(`  destinatario: ${dest}`);
    console.log(`  slack: ${slack.length} nodos, ${prendidos.length} prendidos${prendidos.length ? ' -> ' + prendidos.join(', ') : ' (todos apagados)'}`);
  }
})();
