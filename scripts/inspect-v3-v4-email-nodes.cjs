const fs = require('fs');

const config = JSON.parse(fs.readFileSync('C:\\Users\\Usuario\\.claude.json', 'utf8'));

function connection(name) {
  const env = config.mcpServers?.[name]?.env;
  if (!env?.N8N_API_URL || !env?.N8N_API_KEY) throw new Error(`Falta ${name}.`);
  return { base: env.N8N_API_URL.replace(/\/$/, ''), headers: { 'X-N8N-API-KEY': env.N8N_API_KEY } };
}

async function get(connectionInfo, path) {
  const response = await fetch(`${connectionInfo.base}${path}`, { headers: connectionInfo.headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function workflows(connectionInfo) {
  let cursor = null;
  const all = [];
  do {
    const query = new URLSearchParams({ limit: '250' });
    if (cursor) query.set('cursor', cursor);
    const body = await get(connectionInfo, `/api/v1/workflows?${query}`);
    all.push(...(body.data || []));
    cursor = body.nextCursor || null;
  } while (cursor);
  return all;
}

function nodeSummary(workflow, wanted) {
  const nodes = (workflow.nodes || []).filter((node) => wanted.test(node.name));
  return nodes.map(({ id, name, type, typeVersion, parameters, credentials, disabled }) => ({ id, name, type, typeVersion, parameters, credentials, disabled }));
}

(async () => {
  const v3Connection = connection('archytas-n8n');
  const inventory = await workflows(v3Connection);
  if (process.argv.includes('--candidates')) {
    console.log(JSON.stringify(inventory.filter((workflow) => /ketchum.*(mars|msd)/i.test(workflow.name || '')).map(({ id, name, active, updatedAt }) => ({ id, name, active, updatedAt })), null, 2));
    return;
  }
  const entries = inventory.filter((workflow) => /^Ketchum\s*[-—]\s*(?:Clipping\s+)?(BMS|Booking|Mars|MSD)(?:\s+Clipping)?\s+v3$/i.test(workflow.name || '') && workflow.active);
  const v3 = await Promise.all(entries.map(async (entry) => {
    const workflow = await get(v3Connection, `/api/v1/workflows/${entry.id}`);
    return {
      id: entry.id,
      name: entry.name,
      email_nodes: nodeSummary(workflow, /build html email|send email/i),
      email_connections: Object.fromEntries(Object.entries(workflow.connections || {}).filter(([name]) => /build html email|send email|hay notas/i.test(name))),
    };
  }));
  const v4Connection = connection('ketchum-n8n');
  const v4Workflow = await get(v4Connection, '/api/v1/workflows/ORrmePsGxJJxISTo');
  const v4 = {
    id: v4Workflow.id,
    name: v4Workflow.name,
    email_nodes: nodeSummary(v4Workflow, /email|clipping bms/i),
    email_connections: Object.fromEntries(Object.entries(v4Workflow.connections || {}).filter(([name]) => /email|clipping bms|armar, auditar/i.test(name))),
  };
  if (process.argv.includes('--tier-code')) {
    const pick = (entry) => entry.email_nodes
      .filter((node) => /(?:build html email|preparar email)/i.test(node.name) && node.parameters?.jsCode)
      .map((node) => {
        const code = node.parameters.jsCode;
        const matches = [...code.matchAll(/.{0,500}(?:tier|Tier|TIER).{0,800}/g)];
        return {
          node: node.name,
          tier_snippets: matches.map((match) => match[0]).slice(0, 12),
        };
      });
    console.log(JSON.stringify({ v3: v3.map((entry) => ({ id: entry.id, name: entry.name, nodes: pick(entry) })), v4: pick(v4) }, null, 2));
    return;
  }
  if (process.argv.includes('--tier-render')) {
    const renderSnippets = (entry) => entry.email_nodes
      .filter((node) => node.parameters?.jsCode)
      .map((node) => {
        const code = node.parameters.jsCode;
        const matches = [...code.matchAll(/.{0,700}(?:__adValueFor\(|tierStr|tierEntry).{0,900}/g)];
        return { node: node.name, snippets: matches.map((match) => match[0]).slice(-8) };
      });
    console.log(JSON.stringify({ v3: v3.map((entry) => ({ id: entry.id, name: entry.name, nodes: renderSnippets(entry) })), v4: renderSnippets(v4) }, null, 2));
    return;
  }
  const needleAt = process.argv.indexOf('--needle');
  if (needleAt >= 0 && process.argv[needleAt + 1]) {
    const needle = process.argv[needleAt + 1];
    const contexts = (entry) => entry.email_nodes.filter((node) => node.parameters?.jsCode).map((node) => {
      const code = node.parameters.jsCode;
      const out = [];
      let offset = 0;
      while (out.length < 16) {
        const index = code.indexOf(needle, offset);
        if (index < 0) break;
        out.push(code.slice(Math.max(0, index - 500), index + needle.length + 1100));
        offset = index + needle.length;
      }
      return { node: node.name, contexts: out };
    });
    console.log(JSON.stringify({ v3: v3.map((entry) => ({ id: entry.id, name: entry.name, nodes: contexts(entry) })), v4: contexts(v4) }, null, 2));
    return;
  }
  if (process.argv.includes('--summary')) {
    const compact = (entry) => ({
      id: entry.id,
      name: entry.name,
      nodes: entry.email_nodes.map((node) => ({
        name: node.name,
        type: node.type,
        code_chars: node.parameters?.jsCode?.length || 0,
        send_to: node.parameters?.sendTo || null,
        subject: node.parameters?.subject || null,
        credential: node.credentials ? Object.values(node.credentials)[0]?.name || null : null,
      })),
    });
    console.log(JSON.stringify({ v3: v3.map(compact), v4: compact(v4) }, null, 2));
    return;
  }
  if (process.argv.includes('--dependencies')) {
    const dependencies = v3.map((entry) => ({
      id: entry.id,
      name: entry.name,
      dependencies: entry.email_nodes.filter((node) => node.parameters?.jsCode).map((node) => ({
        node: node.name,
        referenced_nodes: [...node.parameters.jsCode.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]).filter((value, index, all) => all.indexOf(value) === index),
      })),
    }));
    console.log(JSON.stringify(dependencies, null, 2));
    return;
  }
  console.log(JSON.stringify({ v3, v4 }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
