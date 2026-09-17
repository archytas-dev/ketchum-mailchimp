// Primer guardrail de la arquitectura: ninguna ejecución de prearmado puede
// guardar un clipping ni enviar email. Las fases quedan explícitas en Config.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json','utf8')).mcpServers?.['ketchum-n8n']?.env;
const base=env.N8N_API_URL.replace(/\/$/, ''), headers={'X-N8N-API-KEY':env.N8N_API_KEY,'Content-Type':'application/json'};
async function req(path,o={}) { const r=await fetch(base+path,{headers,...o}); const t=await r.text(); if(!r.ok) throw new Error(path+' HTTP '+r.status+' '+t.slice(0,600)); return t?JSON.parse(t):{}; }
(async()=>{
 const id='ORrmePsGxJJxISTo', w=await req('/api/v1/workflows/'+id), a=w.activeVersion||w;
 const cfg=a.nodes.find(n=>n.name==='Config'), gate=a.nodes.find(n=>n.name==='¿enviar email de prueba?');
 if(!cfg||!gate) throw new Error('Faltan nodos esperados');
 let code=String(cfg.parameters.jsCode||'');
 if(!code.includes('fase:')) {
   code=code.replace("const limiteRaw = Number.parseInt(b.limite, 10);", "const fasePedida = String(b.fase || 'cerrar').toLowerCase();\nconst fase = ['prearmar','cerrar','enviar'].includes(fasePedida) ? fasePedida : 'cerrar';\nconst limiteRaw = Number.parseInt(b.limite, 10);");
   code=code.replace('  limite,\n  rehacer,', '  limite,\n  fase,\n  rehacer,');
   cfg.parameters.jsCode=code;
 }
 // El guardado actual está detrás de esta compuerta; fase=prearmar debe cortar
 // antes de ese nodo. Cerrar/enviar se terminan de separar con el sender dedicado.
 gate.parameters.conditions.conditions = [
  { leftValue:"={{ $('Config').first().json.modo }}", rightValue:'test', operator:{type:'string',operation:'equals'} },
  { leftValue:"={{ $('Config').first().json.fase }}", rightValue:'prearmar', operator:{type:'string',operation:'notEquals'} }
 ];
 await req('/api/v1/workflows/'+id,{method:'PUT',body:JSON.stringify({name:w.name,nodes:a.nodes,connections:a.connections,settings:a.settings||w.settings||{}})});
 await req('/api/v1/workflows/'+id+'/publish',{method:'POST',body:'{}'});
 const v=await req('/api/v1/workflows/'+id); const active=v.activeVersion||v;
 const verified=active.nodes.find(n=>n.name==='Config').parameters.jsCode;
 if(!verified.includes("['prearmar','cerrar','enviar']")) throw new Error('No quedó publicado el guardrail.');
 console.log(JSON.stringify({ok:true,workflow:v.name,fases:['prearmar','cerrar','enviar'],prearmado:'no guarda ni envia'},null,2));
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
