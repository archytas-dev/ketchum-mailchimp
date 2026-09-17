const fs = require('fs');
const env = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8')).mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const internos = ['adrian@archytas.io', 'camila@archytas.io', 'fede@archytas.io'];
async function req(path, options = {}) { const r = await fetch(base + path, { headers, ...options }); const t = await r.text(); if (!r.ok) throw new Error(path + ': HTTP ' + r.status + ' ' + t.slice(0, 600)); return t ? JSON.parse(t) : {}; }
async function putPublish(w) { await req('/api/v1/workflows/' + w.id, { method: 'PUT', body: JSON.stringify({ name:w.name,nodes:w.nodes,connections:w.connections,settings:w.settings||{} }) }); await req('/api/v1/workflows/' + w.id + '/publish', { method:'POST',body:'{}' }); }
(async () => {
  const main = await req('/api/v1/workflows/ORrmePsGxJJxISTo');
  const clip = main.nodes.find(n => n.name === 'Armar clipping para email de prueba');
  const prep = main.nodes.find(n => n.name === 'Preparar email v3 de prueba');
  if (!clip || !prep) throw new Error('No encontre el camino de email de prueba.');
  let lookup = main.nodes.find(n => n.name === 'Leer tiers para email');
  if (!lookup) {
    lookup = { id:'tier-email-lookup-v4', name:'Leer tiers para email', type:'n8n-nodes-base.httpRequest', typeVersion:4.2, position:[clip.position[0]+280, clip.position[1]], parameters:{ method:'POST',url:'https://banlcbewinpjtudzdzhm.supabase.co/rest/v1/rpc/v4_email_tier_lookup',authentication:'predefinedCredentialType',nodeCredentialType:'supabaseApi',sendBody:true,specifyBody:'json',jsonBody:"={{ JSON.stringify({ p_client_id: $('Config').first().json.client_id }) }}",options:{response:{response:{neverError:true}},timeout:30000} }, credentials:clip.credentials };
    main.nodes.push(lookup);
    main.connections[clip.name] = { main:[[{ node:lookup.name,type:'main',index:0 }]] };
    main.connections[lookup.name] = { main:[[{ node:prep.name,type:'main',index:0 }]] };
  }
  let code = String(prep.parameters.jsCode || '');
  code = code.replace('const __respuesta = $json || {};', "const __respuesta = $('Armar clipping para email de prueba').first().json || {};");
  code = code.replace('const __tierLookup = {};', "const __tierRespuesta = $json || {};\nconst __tierLookup = (__tierRespuesta.body || __tierRespuesta).lookup || {};" );
  code = code.replace("const __templateConfig = { destinatario: 'adrian@archytas.io', openai_api_key: '' };", "const __templateConfig = { destinatario: 'adrian@archytas.io, camila@archytas.io, fede@archytas.io', openai_api_key: '' };" );
  code = code.replace("para: 'adrian@archytas.io',\n  destinatarios: 1,", "para: 'adrian@archytas.io, camila@archytas.io, fede@archytas.io',\n  destinatarios: 3,");
  if (!code.includes('const __tierLookup = (__tierRespuesta.body || __tierRespuesta).lookup || {};')) throw new Error('No pude conectar el lookup de tiers.');
  prep.parameters.jsCode = code;
  await putPublish(main);
  const sender = await req('/api/v1/workflows/4K8k0C1ptXdSiSdB');
  const guard = sender.nodes.find(n => n.name === 'Guarda dura: modo');
  if (!guard) throw new Error('No encontre la guarda de envio.');
  guard.parameters.jsCode = "const input = $json || {};\nif (String(input.modo || '').toLowerCase() !== 'test') throw new Error('BLOQUEADO: el envio v4 solo esta habilitado en modo=test.');\nif (!input.html || String(input.html).length < 500) throw new Error('BLOQUEADO: HTML de email incompleto.');\nconst internos = " + JSON.stringify(internos) + ";\nreturn { json: { ...input, para: internos.join(', '), destinatarios: internos.length } };";
  const out = sender.nodes.find(n => n.name === 'Salida');
  if (out) out.parameters.jsCode = "const p = $('Guarda dura: modo').first().json;\nreturn [{ json: { enviado:true, para:p.para, destinatarios:p.destinatarios, asunto:p.asunto, bytes_html:p.bytes_html, cliente:p.cliente, modo:'test' } }];";
  await putPublish(sender);
  console.log(JSON.stringify({ internos, tiers:true, mainVersion:(await req('/api/v1/workflows/'+main.id)).activeVersionId, senderVersion:(await req('/api/v1/workflows/'+sender.id)).activeVersionId },null,2));
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
