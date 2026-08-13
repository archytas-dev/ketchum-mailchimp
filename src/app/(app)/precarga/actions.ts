"use server";

import { createClient } from "@/lib/supabase/server";
import { tierNorm } from "@/lib/tier";

// ---------- Tier del medio (pedido de Fedra, 11/08) ----------
//
// OJO: el tier NO es un dato de la nota, es del MEDIO -- vive en la tabla `tiers` y es lo que
// n8n resuelve al armar el mail ("Build Tier Lookup"). Por eso Precarga no guarda un tier
// propio en `notes_precarga`: lo que hace es mostrar el que ya tiene ese medio y dejar
// cambiarlo ahi mismo, escribiendo en `tiers`. Si se guardara por nota habria dos verdades y
// el clipping seguiria usando la del medio.

export type TierDeMedio = { tier: number | null; ad_value: number | null };

export type MedioConocido = { nombre: string; tier: number | null };

// Catálogo de medios ya conocidos por el cliente (tabla `medios`, activos, de nicho o
// generales) con su tier si lo tienen (tabla `tiers`) — alimenta el autocompletado del campo
// Medio en "Agregar notas". Se combinan las dos fuentes por dominio normalizado (mismo `key`
// que usa el resto del código) porque un medio puede tener tier cargado sin estar todavía en
// el catálogo de `medios` (ej. si se cargó a mano desde Precarga antes de sumarlo en Base de
// Datos), y viceversa.
export async function listMediosConTier(clientId: string): Promise<{ ok: boolean; data?: MedioConocido[]; error?: string }> {
  const supabase = await createClient();
  const [{ data: medios, error: mediosError }, { data: tiers, error: tiersError }] = await Promise.all([
    supabase.from("medios").select("nombre, dominio").eq("client_id", clientId).eq("activo", true),
    supabase.from("tiers").select("dominio, medio, tier").eq("client_id", clientId),
  ]);
  if (mediosError) return { ok: false, error: mediosError.message };
  if (tiersError) return { ok: false, error: tiersError.message };

  const tierByKey = new Map((tiers ?? []).map((t) => [t.dominio, t.tier]));
  const porKey = new Map<string, MedioConocido>();
  for (const m of medios ?? []) {
    const nombre = (m.nombre || m.dominio || "").trim();
    if (!nombre) continue;
    const key = tierNorm(nombre);
    if (!key) continue;
    porKey.set(key, { nombre, tier: tierByKey.get(key) ?? null });
  }
  for (const t of tiers ?? []) {
    if (!t.medio || porKey.has(t.dominio)) continue;
    porKey.set(t.dominio, { nombre: t.medio, tier: t.tier });
  }
  const data = [...porKey.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return { ok: true, data };
}

// Devuelve el tier actual de cada medio, indexado por el nombre tal cual lo escribio el
// usuario (la normalizacion es interna).
export async function lookupTiers(
  clientId: string,
  medios: string[],
): Promise<{ ok: boolean; data?: Record<string, TierDeMedio>; error?: string }> {
  const claves = new Map<string, string>();
  for (const m of medios) {
    const k = tierNorm(m);
    if (k) claves.set(k, m);
  }
  if (!claves.size) return { ok: true, data: {} };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tiers")
    .select("dominio, tier, ad_value")
    .eq("client_id", clientId)
    .in("dominio", [...claves.keys()]);
  if (error) return { ok: false, error: error.message };

  const out: Record<string, TierDeMedio> = {};
  for (const row of (data ?? []) as { dominio: string; tier: number | null; ad_value: number | null }[]) {
    const nombreOriginal = claves.get(String(row.dominio).toLowerCase());
    if (nombreOriginal) out[nombreOriginal] = { tier: row.tier, ad_value: row.ad_value };
  }
  return { ok: true, data: out };
}

// Asigna (o crea) el tier del medio. Mismo camino que Base de Datos: nada de .upsert(), porque
// el indice unico de `tiers` es sobre (client_id, lower(dominio)) y PostgREST no sabe apuntar
// a un indice de expresion.
export async function setTierMedio(
  clientId: string,
  nombreMedio: string,
  tier: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const key = tierNorm(nombreMedio);
  if (!key) return { ok: false, error: "Escribí primero el medio para poder asignarle un tier." };
  if (tier !== null && (tier < 1 || tier > 4)) return { ok: false, error: "El tier tiene que ser 1, 2, 3 o 4." };

  const supabase = await createClient();
  const { data: existente, error: findError } = await supabase
    .from("tiers")
    .select("id")
    .eq("client_id", clientId)
    .ilike("dominio", key)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };

  const { error } = existente
    ? await supabase.from("tiers").update({ medio: nombreMedio, tier }).eq("id", existente.id)
    : await supabase.from("tiers").insert({ client_id: clientId, dominio: key, medio: nombreMedio, tier });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type PrecargaNota = {
  medio: string;
  titulo: string;
  url: string;
  snippet: string;
  seccion: string;
  // Fecha PROPIA de la nota (ej. la publicó ayer/anteayer) -- distinta de `fecha`, que es el
  // día del clipping donde tiene que aparecer. YYYY-MM-DD o vacío/undefined = sin especificar.
  pubDate?: string;
};

export type PrecargaRow = {
  id: string;
  fecha: string;
  seccion: string | null;
  medio: string | null;
  titulo: string;
  url: string | null;
  snippet: string | null;
  orden: number;
  consumed_at: string | null;
  pub_date: string | null;
};

// Lista las notas precargadas de un cliente para una fecha (pendientes y ya volcadas).
export async function listPrecarga(
  clientId: string,
  fecha: string,
): Promise<{ ok: boolean; rows?: PrecargaRow[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_precarga")
    .select("id, fecha, seccion, medio, titulo, url, snippet, orden, consumed_at, pub_date")
    .eq("client_id", clientId)
    .eq("fecha", fecha)
    .order("orden", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as PrecargaRow[] };
}

// Precarga notas vía RPC (idempotente por URL, valida acceso al cliente).
export async function addPrecarga(
  clientId: string,
  fecha: string,
  notes: PrecargaNota[],
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const clean = (notes || [])
    .map((n, i) => ({
      medio: String(n.medio || "").trim(),
      titulo: String(n.titulo || "").trim(),
      url: String(n.url || "").trim(),
      snippet: String(n.snippet || "").trim(),
      seccion: String(n.seccion || "").trim(),
      pub_date: n.pubDate ? String(n.pubDate).trim() : null,
      orden: i + 1,
    }))
    .filter((n) => n.titulo && n.url);
  if (!clean.length) return { ok: false, error: "No hay notas válidas (falta título o URL)." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preload_notes", {
    p_client_id: clientId,
    p_fecha: fecha,
    p_notes: clean,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: typeof data === "number" ? data : clean.length };
}

// Edita una nota precargada (solo si todavía no se volcó al clipping).
export async function updatePrecarga(
  id: string,
  patch: { medio?: string; titulo?: string; url?: string; snippet?: string; seccion?: string; pubDate?: string },
): Promise<{ ok: boolean; error?: string }> {
  const fields: Record<string, string | null> = {};
  if (patch.medio !== undefined) fields.medio = String(patch.medio).trim();
  if (patch.titulo !== undefined) fields.titulo = String(patch.titulo).trim();
  if (patch.url !== undefined) fields.url = String(patch.url).trim();
  if (patch.snippet !== undefined) fields.snippet = String(patch.snippet).trim();
  if (patch.seccion !== undefined) fields.seccion = String(patch.seccion).trim();
  if (patch.pubDate !== undefined) fields.pub_date = patch.pubDate.trim() || null;
  if (fields.titulo !== undefined && !fields.titulo) return { ok: false, error: "El título no puede quedar vacío." };
  if (fields.url !== undefined && !fields.url) return { ok: false, error: "La URL no puede quedar vacía." };
  if (fields.seccion !== undefined && !fields.seccion) return { ok: false, error: "La sección no puede quedar vacía." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notes_precarga")
    .update(fields)
    .eq("id", id)
    .is("consumed_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Borra una nota precargada (solo si todavía no se volcó al clipping).
export async function delPrecarga(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notes_precarga")
    .delete()
    .eq("id", id)
    .is("consumed_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Hostname pelado para comparar: sin protocolo, sin "www.", sin path/query, sin punto colgado
// (hay dominios cargados como "voydeviaje.com.ar/." por error de carga).
function normalizeHost(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

// Matchea con subdominios de por medio: la URL puede venir de "ftp.dailyweb.com.ar" mientras
// el medio de nicho está cargado como "dailyweb.com.ar" (o al revés).
function hostMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

// Nombre legible a partir del hostname como último recurso (ej. "dailyweb.com.ar" -> "Dailyweb").
function nombreDesdeHost(host: string): string {
  const base = host.split(".")[0] || host;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Trae título + descripción de una URL (og:tags / meta description) para autocompletar, y
// sugiere el Medio: primero busca si el dominio ya está cargado en "medios de nicho" de este
// cliente y usa ESE nombre (para que quede consistente con lo que ya existe en Base de Datos);
// si no matchea ninguno, cae al nombre del sitio (og:site_name) o, a falta de eso, al hostname.
export async function fetchMeta(
  clientId: string,
  url: string,
): Promise<{ ok: boolean; titulo?: string; snippet?: string; medio?: string; error?: string }> {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: "URL inválida" };
  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
  const decode = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&#8217;/g, "'")
      .replace(/&hellip;/g, "…")
      .replace(/\s+/g, " ")
      .trim();
  const pick = (html: string, res: RegExp[]) => {
    for (const re of res) {
      const m = html.match(re);
      if (m && m[1] && m[1].trim().length > 10) return decode(m[1]);
    }
    return "";
  };
  // `Response.text()` siempre decodifica como UTF-8, sin mirar el charset real de la página.
  // Muchos medios argentinos viejos mandan ISO-8859-1/Windows-1252 sin declararlo bien en el
  // header Content-Type, o lo declaran mal -- un solo byte de una tilde (ej. 0xF3 de "ó") no es
  // UTF-8 válido y termina como "�" (U+FFFD). Se lee el charset declarado (header, y si no hay,
  // el <meta charset> del propio HTML) y se decodifica con eso; si falla, se prueba UTF-8 y por
  // último Windows-1252 (nunca tira error, cubre los 256 valores de byte).
  function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
    const headerMatch = (contentType || "").match(/charset=([^;]+)/i);
    let charset = headerMatch ? headerMatch[1].trim().toLowerCase().replace(/["']/g, "") : "";
    if (!charset) {
      const head = new TextDecoder("windows-1252").decode(buf.slice(0, 2048));
      const metaMatch = head.match(/<meta[^>]+charset=["']?\s*([a-z0-9_-]+)/i);
      charset = metaMatch ? metaMatch[1].toLowerCase() : "utf-8";
    }
    try {
      return new TextDecoder(charset, { fatal: true }).decode(buf);
    } catch {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch {
        return new TextDecoder("windows-1252").decode(buf);
      }
    }
  }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(u, { headers: { "User-Agent": UA }, signal: ctrl.signal, redirect: "follow" });
    clearTimeout(to);
    const html = decodeBody(await r.arrayBuffer(), r.headers.get("content-type"));
    const titulo = pick(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]).replace(/\s*[-|–]\s*[^-|–]+$/, "").trim();
    const snippet = pick(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{20,400})["']/i,
      /<meta[^>]+content=["']([^"']{20,400})["'][^>]+property=["']og:description["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,400})["']/i,
      /<meta[^>]+content=["']([^"']{20,400})["'][^>]+name=["']description["']/i,
    ]);
    const sitioMeta = pick(html, [
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
    ]);

    const urlHost = normalizeHost(u);
    let medio = "";
    if (urlHost) {
      const supabase = await createClient();
      const { data: nicho } = await supabase
        .from("medios")
        .select("dominio, nombre")
        .eq("client_id", clientId)
        .eq("tipo", "monitoreado");
      const match = (nicho ?? []).find((m) => hostMatches(urlHost, normalizeHost(m.dominio || "")));
      if (match) medio = match.nombre || match.dominio;
    }
    if (!medio) medio = sitioMeta || nombreDesdeHost(urlHost);

    return { ok: true, titulo, snippet, medio };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "No se pudo leer la página" };
  }
}
