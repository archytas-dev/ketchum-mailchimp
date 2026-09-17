// La API de detalle devuelve { noticia: {...}, empresa: {...} }; el adaptador
// ya llegaba al JSON pero leía el sobre exterior como si fuera la nota.
const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
const base=env.N8N_API_URL.replace(/\/$/, ''), headers={'X-N8N-API-KEY':env.N8N_API_KEY,'Content-Type':'application/json'};
async function req(path,o={}) { const r=await fetch(base+path,{headers,...o}); const t=await r.text(); if(!r.ok) throw new Error(path+' HTTP '+r.status+' '+t.slice(0,500)); return t?JSON.parse(t):{}; }
(async()=>{
 const w=await req('/api/v1/workflows/mnofS4TurFRTVRsh'); const a=w.activeVersion||w;
 const n=a.nodes.find(x=>x.name==='Extraer la nota'); if(!n) throw new Error('Falta Extraer la nota');
 const old=String(n.parameters.jsCode||'');
 if(!old.includes('[PMFARMA-API-ARTICLE]')) throw new Error('No existe el adaptador PMFarma esperado.');
 if(!old.includes('const noticia = (p && typeof p.noticia')) {
   let code=old.replace('const p = JSON.parse(r.html);\n      if (p && p.noticia) {', "const p = JSON.parse(r.html);\n      const noticia = (p && typeof p.noticia === 'object') ? p.noticia : p;\n      if (noticia && noticia.noticia) {");
   code=code.replace(/p\.titulo/g,'noticia.titulo').replace(/p\.contenido/g,'noticia.contenido').replace(/p\.entradilla/g,'noticia.entradilla').replace(/p\.fecha_no_format/g,'noticia.fecha_no_format').replace(/p\.fecha/g,'noticia.fecha');
   n.parameters.jsCode=code;
 }
 await req('/api/v1/workflows/'+w.id,{method:'PUT',body:JSON.stringify({name:w.name,nodes:a.nodes,connections:a.connections,settings:a.settings||w.settings||{}})});
 await req('/api/v1/workflows/'+w.id+'/publish',{method:'POST',body:'{}'});
 console.log(JSON.stringify({ok:true,workflow:w.name,fix:'api PMFarma envelope noticia'},null,2));
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
