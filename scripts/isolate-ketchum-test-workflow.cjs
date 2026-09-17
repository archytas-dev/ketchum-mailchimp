// Cambia el armado v4 para que modo=test use exclusivamente las RPC v4_test_*
// (que escriben en schema test). Produccion conserva exactamente sus endpoints.
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));
const env = config.mcpServers?.['ketchum-n8n']?.env;
const base = env.N8N_API_URL.replace(/\/$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const id = 'ORrmePsGxJJxISTo';
const supabase = 'https://banlcbewinpjtudzdzhm.supabase.co/rest/v1';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}
function node(workflow, name) {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(`No encontre el nodo ${name}.`);
  return found;
}
function rpc(testName, prodName) {
  return `={{ $('Config').first().json.modo === 'test' ? '${supabase}/rpc/${testName}' : '${supabase}/rpc/${prodName}' }}`;
}

(async () => {
  const workflow = await request(`/api/v1/workflows/${id}`);
  const cfg = node(workflow, 'Config');
  cfg.parameters.jsCode = `const b = ($json && $json.body) || $json || {};
// La fecha por defecto la calcula la base en hora argentina.
const rehacerRaw = String(b.rehacer ?? '').toLowerCase();
const rehacer = b.rehacer === true || ['1', 'true', 'si', 'sí'].includes(rehacerRaw);
const limiteRaw = Number.parseInt(b.limite, 10);
const limite = Number.isFinite(limiteRaw) && limiteRaw > 0 ? Math.min(limiteRaw, 30) : null;
return [{ json: {
  client_id: b.client_id || null,
  slug: b.slug || null,
  fecha: b.fecha || null,
  modo: String(b.modo || 'test').toLowerCase() === 'prod' ? 'prod' : 'test',
  limite,
  rehacer,
  // Solo existe en las reentradas de una prueba. Impide abrir otra corrida.
  run_id: b.run_id || null
} }];`;

  const open = node(workflow, 'Abrir corrida del día');
  open.parameters.url = rpc('v4_test_abrir_run', 'v4_abrir_run');
  open.parameters.jsonBody = `={{ JSON.stringify($json.modo === 'test'
    ? { p_client_id: $json.client_id, p_fecha: $json.fecha, p_trigger: 'webhook-test', p_run_id: $json.run_id }
    : { p_client_id: $json.client_id, p_modo: 'prod', p_fecha: $json.fecha, p_trigger: 'webhook', p_rehacer: $json.rehacer }) }}`;

  const materialize = node(workflow, 'Materializar pool');
  materialize.parameters.url = rpc('v4_test_materializar_candidatas', 'v4_materializar_candidatas');
  materialize.parameters.jsonBody = `={{ JSON.stringify({ p_run_id: $('Abrir corrida del día').first().json.run_id, p_tope: $('Config').first().json.limite }) }}`;

  const take = node(workflow, 'Tomar pagina');
  take.parameters.url = rpc('v4_test_tomar_pagina', 'v4_tomar_pagina');
  take.parameters.jsonBody = `={{ JSON.stringify({ p_run_id: $('Abrir corrida del día').first().json.run_id, p_limite: 20, p_lease_seconds: 1800 }) }}`;

  const read = node(workflow, 'Leer lote');
  read.parameters.url = rpc('v4_test_candidatas_del_lote', 'v4_candidatas_del_lote');
  read.parameters.jsonBody = `={{ JSON.stringify({ p_run_id: $('Abrir corrida del día').first().json.run_id, p_desde_orden: $('Tomar pagina').first().json.desde_orden, p_limite: 20 }) }}`;

  const save = node(workflow, 'Guardar veredictos');
  save.parameters.url = `={{ $('Config').first().json.modo === 'test' ? '${supabase}/rpc/v4_test_guardar_veredictos' : '${supabase}/candidatas_veredicto?on_conflict=client_id,fecha,modo,candidata_id' }}`;
  save.parameters.jsonBody = `={{ JSON.stringify($('Config').first().json.modo === 'test'
    ? { p_run_id: $('Abrir corrida del día').first().json.run_id, p_filas: $json.filas }
    : $json.filas) }}`;

  const finishPage = node(workflow, 'Terminar pagina');
  finishPage.parameters.url = rpc('v4_test_terminar_pagina', 'v4_terminar_pagina');

  const decide = node(workflow, 'Armar, auditar y decidir nivel');
  decide.parameters.url = rpc('v4_test_decidir_nivel', 'decidir_nivel');
  decide.parameters.jsonBody = `={{ JSON.stringify($('Config').first().json.modo === 'test'
    ? { p_run_id: $('Abrir corrida del día').first().json.run_id }
    : { p_client_id: $('Config').first().json.client_id, p_fecha: $('Config').first().json.fecha, p_modo: 'prod' }) }}`;

  const summary = node(workflow, 'Resumen de la corrida');
  summary.parameters.jsCode = `// Esta ejecucion solo cierra la ultima pagina. Los veredictos de las paginas
// anteriores viven en la base, asi que no se consulta el historial efimero de n8n.
const cfg = $('Config').first().json;
const n = (items[0] && items[0].json) || {};
return [{ json: {
  cliente: cfg.client_id, fecha: n.fecha || cfg.fecha, modo: cfg.modo,
  nivel: n.nivel ?? null, motivo: n.motivo || null, sale: n.sale ?? null,
  candidatas: n.candidatas ?? null, candidatas_es_muestra: n.candidatas_es_muestra ?? null,
  candidatas_tope: n.candidatas_tope ?? null, juzgadas: n.juzgadas ?? null,
  entran: n.entran ?? null, forzadas: n.forzadas ?? null, notas_finales: n.notas_finales ?? null,
  avisos: n.avisos || [], veredictos_calculados: n.juzgadas ?? null,
  veredictos_repetidos_del_a2: null, veredictos_guardados: n.juzgadas ?? null,
  escrituras_lotes: null, escritura_status: null
} }];`;

  const close = node(workflow, 'Cerrar corrida');
  close.parameters.url = rpc('v4_test_cerrar_run', 'v4_cerrar_run');
  close.parameters.jsonBody = `={{ JSON.stringify({ p_run_id: $('Abrir corrida del día').first().json.run_id, p_nivel: $json.nivel ?? null, p_detalle: $json }) }}`;

  const next = node(workflow, 'Disparar pagina siguiente');
  next.parameters.jsonBody = `={{ JSON.stringify({ client_id: $('Config').first().json.client_id, fecha: $('Config').first().json.fecha, modo: $('Config').first().json.modo, rehacer: false, run_id: $('Abrir corrida del día').first().json.run_id }) }}`;

  const emailClipping = node(workflow, 'Armar clipping para email de prueba');
  emailClipping.parameters.url = `${supabase}/rpc/v4_test_armar_clipping`;
  emailClipping.parameters.jsonBody = `={{ JSON.stringify({ p_run_id: $('Abrir corrida del día').first().json.run_id }) }}`;

  await request(`/api/v1/workflows/${id}`, {
    method: 'PUT', body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} }),
  });
  await request(`/api/v1/workflows/${id}/publish`, { method: 'POST', body: '{}' });

  const verified = await request(`/api/v1/workflows/${id}`);
  const active = verified.activeVersion || verified;
  const checks = {
    configKeepsRunId: /run_id: b\.run_id/.test(node(active, 'Config').parameters.jsCode || ''),
    isolatedOpen: /v4_test_abrir_run/.test(node(active, 'Abrir corrida del día').parameters.url || ''),
    isolatedSave: /v4_test_guardar_veredictos/.test(node(active, 'Guardar veredictos').parameters.url || ''),
    isolatedEmail: /v4_test_armar_clipping/.test(node(active, 'Armar clipping para email de prueba').parameters.url || ''),
    summaryDoesNotReadN8nHistory: !/Armar veredictos'\)\.all/.test(node(active, 'Resumen de la corrida').parameters.jsCode || ''),
    testMailStillOnly: /modo.*test/.test(node(active, '¿enviar email de prueba?').parameters.conditions ? JSON.stringify(node(active, '¿enviar email de prueba?').parameters.conditions) : ''),
  };
  if (Object.values(checks).some((value) => !value)) throw new Error(`Publicacion incompleta: ${JSON.stringify(checks)}`);
  console.log(JSON.stringify({ workflow: verified.name, activeVersionId: verified.activeVersionId, checks }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
