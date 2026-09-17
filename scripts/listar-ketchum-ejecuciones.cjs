const fs = require('fs');
const [workflowId] = process.argv.slice(2);
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
(async () => {
 const url = env.N8N_API_URL.replace(/\/$/, '') + '/api/v1/executions?limit=20' + (workflowId ? '&workflowId=' + encodeURIComponent(workflowId) : '');
 const r = await fetch(url, { headers:{'X-N8N-API-KEY':env.N8N_API_KEY} }); if (!r.ok) throw new Error('HTTP '+r.status);
 const b=await r.json(); console.log(JSON.stringify((b.data||b).map(x=>({id:x.id,workflowId:x.workflowId,status:x.status,startedAt:x.startedAt,stoppedAt:x.stoppedAt})),null,2));
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
