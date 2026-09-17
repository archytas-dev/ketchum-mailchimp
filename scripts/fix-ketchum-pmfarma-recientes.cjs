const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
const base=env.N8N_API_URL.replace(/\/$/, ''), headers={'X-N8N-API-KEY':env.N8N_API_KEY,'Content-Type':'application/json'};
async function req(path,o={}) { const r=await fetch(base+path,{headers,...o}); const t=await r.text(); if(!r.ok) throw new Error(path+' HTTP '+r.status+' '+t.slice(0,400)); return t?JSON.parse(t):{}; }
(async()=>{
 for (const id of ['UUIlvhTv3Rjy9YEP','tzcHSIUdMGXVRFIo']) {
  const w=await req('/api/v1/workflows/'+id), a=w.activeVersion||w;
  const n=(a.nodes||[]).find(x=>x.name==='Normalizar → contrato' || x.name==='Normalizar → notas');
  if(!n) throw new Error(w.name+': falta normalizador');
  const old=String(n.parameters.jsCode||'');
  if(!old.includes('const rows = Array.isArray(data?.noticias) ? data.noticias : [];')) throw new Error(w.name+': parser PMFarma inesperado');
  n.parameters.jsCode=old.replace('const rows = Array.isArray(data?.noticias) ? data.noticias : [];', 'const rows = Array.isArray(data) ? data : (Array.isArray(data?.noticias) ? data.noticias : []);');
  await req('/api/v1/workflows/'+id,{method:'PUT',body:JSON.stringify({name:w.name,nodes:a.nodes,connections:a.connections,settings:a.settings||w.settings||{}})});
  await req('/api/v1/workflows/'+id+'/publish',{method:'POST',body:'{}'});
 }
 console.log(JSON.stringify({ok:true,endpoint:'api/noticias-recientes',parser:'array y envelope'},null,2));
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
