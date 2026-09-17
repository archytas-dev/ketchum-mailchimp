const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const r = await fetch(`${base}${path}`, { headers, ...options });
  const text = await r.text();
  if (!r.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${r.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}
function node(w, name) {
  const n = w.nodes.find(x => x.name === name);
  if (!n) throw new Error(`No encontré el nodo ${name}.`);
  return n;
}
function once(code, from, to, label) {
  const count = code.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: esperaba 1 coincidencia y encontré ${count}.`);
  return code.replace(from, to);
}

(async () => {
  const a2Id = '9pwrSH2KdpGhbXjS';
  const mainId = 'ORrmePsGxJJxISTo';

  const a2 = await request(`/api/v1/workflows/${a2Id}`);
  const pedido = node(a2, 'Armar el pedido');
  pedido.parameters.jsCode = once(
    pedido.parameters.jsCode,
    "en el formato de la ADENDA v2.",
    "en el formato de la ADENDA v3.",
    'A2 pedido'
  );
  const aplicar = node(a2, 'Aplicar el veredicto');
  let codigo = aplicar.parameters.jsCode;
  codigo = once(
    codigo,
    'let forzada = false, motivo = null;',
    "let forzada = false;\n  const motivoModelo = v && typeof v.motivo === 'string' ? v.motivo.trim().slice(0, 320) : null;\n  let motivo = entra === false ? motivoModelo : null;",
    'A2 motivo modelo'
  );
  codigo = once(
    codigo,
    "  return { json: { candidata_id: n.candidata_id, titulo: n.titulo, snippet: n.snippet, entra, seccion, confianza, forzada, motivo_forzada: motivo, diagnostico: diag, es_prioritaria: !!n.es_prioritaria, tokens: r.tokens ?? 0, costo_usd: r.costo_usd ?? null } };",
    "  if (entra === false && !motivo) motivo = 'A2 descartó la nota sin devolver motivo';\n  if (entra === null && !motivo) motivo = 'A2 no devolvió veredicto';\n  return { json: { candidata_id: n.candidata_id, titulo: n.titulo, snippet: n.snippet, entra, seccion, confianza, forzada, motivo, motivo_forzada: forzada ? motivo : null, diagnostico: diag, es_prioritaria: !!n.es_prioritaria, tokens: r.tokens ?? 0, costo_usd: r.costo_usd ?? null } };",
    'A2 salida trazable'
  );
  aplicar.parameters.jsCode = codigo;
  await request(`/api/v1/workflows/${a2Id}`, { method: 'PUT', body: JSON.stringify({ name: a2.name, nodes: a2.nodes, connections: a2.connections, settings: a2.settings || {} }) });
  await request(`/api/v1/workflows/${a2Id}/publish`, { method: 'POST', body: '{}' });

  const main = await request(`/api/v1/workflows/${mainId}`);
  for (const name of ['Armar veredictos', 'Armar veredictos finales']) {
    const n = node(main, name);
    let js = n.parameters.jsCode;
    const needle = 'motivo_forzada: x.motivo_forzada || null,';
    if (!js.includes('motivo: x.motivo || null,')) {
      if (!js.includes(needle)) throw new Error(`${name}: no encontré el campo motivo_forzada.`);
      js = js.replaceAll(needle, `${needle}\n    motivo: x.motivo || null,`);
    }
    if (name === 'Armar veredictos finales' && !js.includes("motivo: prioritaria ? 'A2 incompleto luego del reintento; prioridad preservada'")) {
      js = once(
        js,
        "motivo_forzada: prioritaria ? 'A2 incompleto luego del reintento; prioridad preservada' : null,",
        "motivo_forzada: prioritaria ? 'A2 incompleto luego del reintento; prioridad preservada' : null,\n    motivo: prioritaria ? 'A2 incompleto luego del reintento; prioridad preservada' : 'A2 no devolvió veredicto luego del reintento',",
        'A2 incompleto trazable'
      );
    }
    n.parameters.jsCode = js;
  }
  await request(`/api/v1/workflows/${mainId}`, { method: 'PUT', body: JSON.stringify({ name: main.name, nodes: main.nodes, connections: main.connections, settings: main.settings || {} }) });
  await request(`/api/v1/workflows/${mainId}/publish`, { method: 'POST', body: '{}' });

  const [a2Check, mainCheck] = await Promise.all([
    request(`/api/v1/workflows/${a2Id}`), request(`/api/v1/workflows/${mainId}`)
  ]);
  const a2Active = a2Check.activeVersion || a2Check;
  const mainActive = mainCheck.activeVersion || mainCheck;
  const checks = {
    promptV3: node(a2Active, 'Armar el pedido').parameters.jsCode.includes('ADENDA v3'),
    a2SendsMotivo: node(a2Active, 'Aplicar el veredicto').parameters.jsCode.includes('motivo, motivo_forzada'),
    mainSavesMotivo: ['Armar veredictos', 'Armar veredictos finales'].every(n => node(mainActive, n).parameters.jsCode.includes('motivo: x.motivo || null')),
    testStillIsolated: node(mainActive, 'Guardar veredictos').parameters.url.includes('v4_test_guardar_veredictos')
  };
  if (Object.values(checks).some(v => !v)) throw new Error(`Verificación incompleta: ${JSON.stringify(checks)}`);
  console.log(JSON.stringify({ a2Version: a2Check.activeVersionId, mainVersion: mainCheck.activeVersionId, checks }, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
