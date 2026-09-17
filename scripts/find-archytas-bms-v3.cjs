const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['archytas-n8n']?.env;
if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error('Falta la conexion archytas-n8n.');

const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY };

(async () => {
  if (process.argv[2] === '--execution') {
    const executionId = process.argv[3];
    if (!executionId) throw new Error('Falta executionId.');
    const response = await fetch(`${base}/api/v1/executions/${executionId}?includeData=true`, { headers });
    if (!response.ok) throw new Error(`Ejecucion ${executionId}: HTTP ${response.status}`);
    const execution = await response.json();
    const runData = execution.data?.resultData?.runData || {};
    const nodeArg = process.argv.indexOf('--node');
    if (nodeArg !== -1) {
      const nodeName = process.argv[nodeArg + 1];
      const runs = runData[nodeName] || [];
      const output = runs.at(-1)?.data?.main?.[0] || [];
      console.log(JSON.stringify({ node: nodeName, runs: runs.length, items: output.length, json: output.map((item) => item.json) }, null, 2));
      return;
    }
    const nodes = Object.entries(runData).map(([name, runs]) => ({
      name,
      runs: runs.length,
      items: runs.reduce((total, run) => total + (run.data?.main?.[0]?.length || 0), 0),
    }));
    console.log(JSON.stringify({
      id: execution.id,
      status: execution.status,
      lastNode: execution.data?.resultData?.lastNodeExecuted || null,
      nodes,
    }, null, 2));
    return;
  }
  let cursor = null;
  const all = [];
  do {
    const url = new URL(`${base}/api/v1/workflows`);
    url.searchParams.set('limit', '250');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    all.push(...(body.data || []));
    cursor = body.nextCursor || null;
  } while (cursor);
  const rows = all.filter((workflow) => /bms/i.test(workflow.name || ''));
  const workflows = await Promise.all(rows.map(async ({ id, name, active, updatedAt }) => {
    const executions = await fetch(`${base}/api/v1/executions?workflowId=${id}&limit=10`, { headers });
    if (!executions.ok) throw new Error(`Ejecuciones ${id}: HTTP ${executions.status}`);
    const executionData = (await executions.json()).data || [];
    return {
      id,
      name,
      active,
      updatedAt,
      ejecuciones: executionData.map(({ id: executionId, status, startedAt, stoppedAt }) => ({ executionId, status, startedAt, stoppedAt })),
    };
  }));
  console.log(JSON.stringify(workflows, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
