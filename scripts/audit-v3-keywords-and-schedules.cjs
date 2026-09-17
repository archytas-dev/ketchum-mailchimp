const fs = require('fs');

const workflows = {
  bms: 'bgabQ3ICjdex0ppC',
  booking: 'Km1e6ZWLYEl9hQRV',
  mars: 'VwGjBYNQvi51ZhR7',
  msd: '19NPw3POuwTKdUsK',
};
const clientArgIndex = process.argv.indexOf('--client');
const onlyClient = clientArgIndex === -1 ? null : String(process.argv[clientArgIndex + 1] || '').toLowerCase();
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['archytas-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };

async function get(path) {
  const response = await fetch(base + path, { headers });
  if (!response.ok) throw new Error(path + ': HTTP ' + response.status);
  return response.json();
}

(async () => {
  const report = {};
  for (const [client, id] of Object.entries(workflows)) {
    if (onlyClient && client !== onlyClient) continue;
    const workflow = await get('/api/v1/workflows/' + id);
    const active = workflow.activeVersion || workflow;
    report[client] = {
      id,
      name: workflow.name,
      active: workflow.active,
      schedules: (active.nodes || []).filter((n) => /scheduleTrigger|cron/i.test(n.type || ''))
        .map((n) => ({ name: n.name, rule: n.parameters?.rule || null })),
      keyword_nodes: process.argv.includes('--morning') ? [] : (active.nodes || []).filter((n) => /keyword|filter|ai filter|pre.filter/i.test(n.name || ''))
        .map((n) => {
          const code = String(n.parameters?.jsCode || '');
          const markers = ['titleMatchesAnyKeyword', 'keyword_match', 'matchesBmsRelevant', 'matchesAnyKeyword', 'return false', 'return true'];
          const excerpts = markers.flatMap((marker) => {
            const at = code.indexOf(marker);
            return at === -1 ? [] : [code.slice(Math.max(0, at - 220), Math.min(code.length, at + 520))];
          });
          return {
            name: n.name,
            type: n.type,
            uses_keyword_match: /keyword_match|titleMatchesAnyKeyword|matchesAnyKeyword/.test(code),
            excerpts: [...new Set(excerpts)],
            ...(process.argv.includes('--full') ? { jsCode: code } : {}),
          };
        }),
    };
    if (process.argv.includes('--morning')) {
      const executions = await get('/api/v1/executions?workflowId=' + id + '&limit=12');
      report[client].recent_executions = (executions.data || []).map(e => ({ id:e.id, status:e.status, startedAt:e.startedAt, stoppedAt:e.stoppedAt }));
    }
  }
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
