const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['archytas-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta archytas-n8n.');
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
async function allWorkflows() {
  const all = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ limit: '250' });
    if (cursor) params.set('cursor', cursor);
    const page = await get(`/api/v1/workflows?${params}`);
    all.push(...(page.data || []));
    cursor = page.nextCursor || null;
  } while (cursor);
  return all;
}

(async () => {
  const inventory = await allWorkflows();
  const candidates = inventory.filter((workflow) => workflow.active && /^Ketchum\s*[-—]/i.test(workflow.name || '') && /(BMS|Booking|Mars|MSD)/i.test(workflow.name || ''));
  const report = [];
  for (const entry of candidates) {
    const workflow = await get(`/api/v1/workflows/${entry.id}`);
    const active = workflow.activeVersion || workflow;
    const nodes = active.nodes || [];
    const schedules = nodes.filter((node) => /scheduleTrigger|cron/i.test(node.type || '')).map((node) => ({ name: node.name, parameters: node.parameters }));
    const hasMail = nodes.some((node) => node.name === 'Build HTML Email' || node.name === 'Send Email');
    const starts = nodes.filter((node) => /Schedule Trigger|Cron|Trigger/i.test(node.name || '')).map((node) => node.name);
    if (schedules.length || hasMail) report.push({ id: entry.id, name: entry.name, schedules, hasMail, starts });
  }
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
