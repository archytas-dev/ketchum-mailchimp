#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const CLIENTS = {
  bms: '99a7b1e3-2b24-4364-a055-be338bfff34a',
  booking: '65170cb4-0646-4602-b5b5-f1b93e6762d4',
  mars: '145311f2-79a0-430b-b528-c9683d1e196f',
  msd: '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026',
};

function loadLocalEnv() {
  const file = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=', 2);
    if (inline !== undefined) {
      args[key] = inline;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function usage() {
  console.error('Uso: node scripts/golden-diff.mjs --client booking --date 2026-09-08 [--mode test] [--json]');
  console.error('Clientes: bms, booking, mars, msd (tambien acepta UUID).');
}

function canonicalUrl(value) {
  if (!value) return null;
  let current = String(value).trim();

  // v4.url_canonica se guarda como host/path sin protocolo. Agregamos uno
  // solo para que URL() aplique la misma normalización que a la URL completa
  // de v3; el protocolo no forma parte de la clave devuelta.
  const parseableUrl = (candidate) =>
    /^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`;

  // La v3 conserva a veces el wrapper de Google. Desenrollamos los formatos
  // con parametro; el token base64 de RSS ya llega decodificado en v4 y se
  // compara por titulo cuando no podemos reconstruirlo desde la v3.
  for (let i = 0; i < 2; i += 1) {
    try {
      const parsed = new URL(parseableUrl(current));
      const target = ['url', 'q', 'u', 'redirect'].map((key) => parsed.searchParams.get(key)).find(Boolean);
      if (!target) break;
      current = decodeURIComponent(target);
    } catch {
      break;
    }
  }

  try {
    const parsed = new URL(parseableUrl(current));
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$|ref$|referrer$)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    // public.url_canonica() guarda host/path sin protocolo; devolver la misma
    // forma evita que el arnes marque como distintos dos URLs ya equivalentes.
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch {
    return current.toLowerCase().replace(/\/$/, '');
  }
}

function normalizeTitle(value) {
  return String(value || '')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&(?:apos|#39);/gi, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function domainOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function rowKey(row) {
  return row.candidata_id || row.id || row.url || row.titulo;
}

function matchRows(v3, v4) {
  const byUrl = new Map();
  const byTitle = new Map();

  for (const row of v4) {
    const url = canonicalUrl(row.url_canonica || row.url);
    const title = normalizeTitle(row.titulo);
    if (url) byUrl.set(url, [...(byUrl.get(url) || []), row]);
    if (title) byTitle.set(title, [...(byTitle.get(title) || []), row]);
  }

  const matchedV4 = new Set();
  const matched = [];
  const onlyV3 = [];

  for (const oldRow of v3) {
    const url = canonicalUrl(oldRow.url);
    const urlMatches = url ? (byUrl.get(url) || []) : [];
    const titleKey = normalizeTitle(oldRow.titulo);
    const titleMatches = (byTitle.get(titleKey) || []).filter((row) => !matchedV4.has(rowKey(row)));
    const domain = domainOf(oldRow.url);
    const domainMatches = titleMatches.filter((row) =>
      (domain && domain !== 'google.com' && domainOf(row.url_canonica || row.url) === domain)
      || (domain && domain !== 'google.com' && row.dominio_norm === domain));
    const candidates = urlMatches.length
      ? urlMatches
      : (domainMatches.length === 1 ? domainMatches : (titleMatches.length === 1 ? titleMatches : []));
    const candidate = candidates.find((row) => !matchedV4.has(rowKey(row)));

    if (!candidate) {
      onlyV3.push(oldRow);
      continue;
    }

    const method = urlMatches.length ? 'url_canonica' : 'titulo+dominio';
    matchedV4.add(rowKey(candidate));
    matched.push({
      method,
      v3: oldRow,
      v4: candidate,
    });
  }

  return {
    matched,
    onlyV3,
    onlyV4: v4.filter((row) => !matchedV4.has(rowKey(row))),
  };
}

async function fetchAll(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const clientArg = String(args.client || '').toLowerCase();
  const clientId = CLIENTS[clientArg] || args.client;
  const date = args.date;
  const mode = String(args.mode || 'test').toLowerCase();

  if (!clientId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage();
    process.exitCode = 2;
    return;
  }

  const url = process.env.KETCHUM_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.KETCHUM_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const [{ data: client, error: clientError }, v3, verdicts, runs] = await Promise.all([
    supabase.from('clients').select('id,slug,nombre').eq('id', clientId).maybeSingle(),
    fetchAll(supabase
      .from('notes')
      .select('id,clipping_id,seccion,medio,titulo,snippet,url,pub_date,orden,incluida,origen')
      .eq('incluida', true)
      .in('clipping_id', (await fetchAll(supabase.from('clippings').select('id').eq('client_id', clientId).eq('fecha', date))).map((row) => row.id))
      .order('orden', { ascending: true })),
    fetchAll(supabase
      .from('candidatas_veredicto')
      .select('id,candidata_id,entra,seccion,confianza,forzada,motivo_forzada,agente,modo,fecha,candidatas_raw!inner(url,titulo,snippet,dominio_norm,url_canonica,fecha_pub)')
      .eq('client_id', clientId)
      .eq('fecha', date)
      .eq('modo', mode)
      .eq('entra', true)),
    fetchAll(supabase
      .from('pipeline_runs')
      .select('id,arranco_at,termino_at,nivel_salida,estado,detalle,modo,trigger')
      .eq('client_id', clientId)
      .eq('fecha', date)
      .eq('modo', mode)
      .order('arranco_at', { ascending: false })
      .limit(1)),
  ]);

  if (clientError) throw new Error(clientError.message);
  if (!client) throw new Error(`Cliente no encontrado: ${clientId}`);

  const v4 = verdicts.map((row) => ({
    ...row.candidatas_raw,
    candidata_id: row.candidata_id,
    seccion: row.seccion,
    confianza: row.confianza,
    forzada: row.forzada,
    motivo_forzada: row.motivo_forzada,
  }));
  const diff = matchRows(v3, v4);
  const detail = runs[0]?.detalle || {};
  const result = {
    client: client.slug,
    client_id: client.id,
    client_name: client.nombre,
    date,
    mode,
    baseline_v3: v3.length,
    v4_entered: v4.length,
    matched: diff.matched.length,
    matched_by_url: diff.matched.filter((row) => row.method === 'url_canonica').length,
    matched_by_title_domain: diff.matched.filter((row) => row.method === 'titulo+dominio').length,
    only_v3: diff.onlyV3.length,
    only_v4: diff.onlyV4.length,
    v4_run: runs[0] ? {
      id: runs[0].id,
      estado: runs[0].estado,
      nivel_salida: runs[0].nivel_salida,
      arranco_at: runs[0].arranco_at,
      termino_at: runs[0].termino_at,
      candidatas: detail.candidatas ?? null,
      candidatas_es_muestra: detail.candidatas_es_muestra ?? null,
      candidatas_tope: detail.candidatas_tope ?? null,
    } : null,
    differences: {
      only_v3: diff.onlyV3.map((row) => ({ titulo: row.titulo, url: row.url, seccion: row.seccion })),
      only_v4: diff.onlyV4.map((row) => ({ candidata_id: row.candidata_id, titulo: row.titulo, url: row.url_canonica, seccion: row.seccion })),
    },
    warning: detail.candidatas_es_muestra === true
      ? 'La corrida v4 está marcada como muestra; este resultado no es un golden de cobertura completa.'
      : null,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Golden diff ${client.slug} ${date} (${mode})`);
  console.log(`v3 incluidas: ${result.baseline_v3}`);
  console.log(`v4 entra: ${result.v4_entered}`);
  console.log(`match URL: ${result.matched_by_url} · match título+dominio: ${result.matched_by_title_domain}`);
  console.log(`solo v3: ${result.only_v3} · solo v4: ${result.only_v4}`);
  if (result.warning) console.log(`AVISO: ${result.warning}`);
  if (result.v4_run) console.log(`run v4: ${result.v4_run.id} · ${result.v4_run.estado} · nivel ${result.v4_run.nivel_salida}`);
  if (result.only_v3) console.log('\nSolo v3:\n' + result.differences.only_v3.map((row) => `- ${row.titulo} | ${row.url}`).join('\n'));
  if (result.only_v4) console.log('\nSolo v4:\n' + result.differences.only_v4.map((row) => `- ${row.titulo} | ${row.url}`).join('\n'));
}

main().catch((error) => {
  console.error(`golden-diff: ${error.message}${error.cause?.message ? ` (${error.cause.message})` : ''}`);
  process.exitCode = 1;
});
