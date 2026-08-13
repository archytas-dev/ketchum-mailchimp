"use server";

import { createClient } from "@/lib/supabase/server";
import { tierNorm } from "@/lib/tier";

type Ok<T = undefined> = { ok: true } & (T extends undefined ? unknown : { data: T });
type Err = { ok: false; error: string };
type Result<T = undefined> = Ok<T> | Err;

// ---------- Medios (de nicho = monitoreado, generales = adicional) ----------

export type MedioRow = {
  id: string;
  dominio: string;
  nombre: string | null;
  origen: string;
  metodo: string | null;
  activo: boolean;
  notas_total: number | null;
  primer_uso: string | null;
  tier: number | null;
  ad_value: number | null;
  alcance: number | null;
};

export async function listMedios(
  clientId: string,
  tipo: "monitoreado" | "adicional",
): Promise<Result<MedioRow[]>> {
  const supabase = await createClient();
  const [{ data: medios, error }, { data: tiers, error: tiersError }] = await Promise.all([
    supabase
      .from("medios")
      .select("id, dominio, nombre, origen, metodo, activo, notas_total, primer_uso")
      .eq("client_id", clientId)
      .eq("tipo", tipo)
      .order("nombre", { ascending: true }),
    supabase.from("tiers").select("dominio, tier, ad_value, alcance").eq("client_id", clientId),
  ]);
  if (error) return { ok: false, error: error.message };
  if (tiersError) return { ok: false, error: tiersError.message };

  const tierByKey = new Map((tiers ?? []).map((t) => [t.dominio, t]));
  const rows: MedioRow[] = (medios ?? []).map((m) => {
    const t = tierByKey.get(tierNorm(m.nombre || m.dominio));
    return { ...m, tier: t?.tier ?? null, ad_value: t?.ad_value ?? null, alcance: t?.alcance ?? null };
  });
  return { ok: true, data: rows };
}

// Ketchum es clipping de medios argentinos: un dominio con ccTLD de otro país no tiene que
// poder cargarse nunca, ni a mano ni por script -- ver medios "adicionales" .es/.cl/.mx/etc.
// que se colaron en BMS el 2026-08-06 sin pasar por este flujo.
const TLDS_BLOQUEADOS = new Set([
  "es", "mx", "cl", "co", "pe", "uy", "bo", "py", "ve", "ec",
  "br", "pa", "cr", "gt", "hn", "ni", "sv", "do", "pr", "cu",
]);

function normalizeDominio(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

function tldBloqueado(dominio: string): string | null {
  const partes = dominio.split(".").filter(Boolean);
  const ultimo = partes[partes.length - 1];
  return ultimo && TLDS_BLOQUEADOS.has(ultimo) ? ultimo : null;
}

export async function addMedio(
  clientId: string,
  tipo: "monitoreado" | "adicional",
  input: { dominio: string; nombre: string; tier?: number | null; ad_value?: number | null; alcance?: number | null },
): Promise<Result> {
  const dominio = normalizeDominio(input.dominio);
  const nombre = input.nombre.trim();
  if (!dominio) return { ok: false, error: "Falta el dominio." };
  const tld = tldBloqueado(dominio);
  if (tld) {
    return {
      ok: false,
      error: `"${dominio}" es un dominio .${tld} — la cobertura es de medios argentinos, no se puede sumar.`,
    };
  }

  const supabase = await createClient();
  // origen='cliente' + activo=true: entra a la lista de scrapeo permanente desde la proxima
  // corrida, sin paso manual adicional (lo pide el ticket explicitamente).
  const { error } = await supabase.from("medios").insert({
    client_id: clientId,
    dominio,
    nombre: nombre || null,
    tipo,
    origen: "cliente",
    activo: true,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ese dominio ya existe para este cliente." };
    return { ok: false, error: error.message };
  }

  // Si se cargó tier/ad_value/alcance al sumar el medio, se guarda de una en `tiers` -- mismo
  // camino que editarlo despues desde la tabla. El medio ya quedó creado igual si esto falla.
  const tieneDatosDeTier = input.tier != null || input.ad_value != null || input.alcance != null;
  if (tieneDatosDeTier) {
    const res = await updateMedioTier(clientId, nombre || dominio, {
      tier: input.tier ?? null,
      ad_value: input.ad_value ?? null,
      alcance: input.alcance ?? null,
    });
    if (!res.ok) return res;
  }
  return { ok: true };
}

export async function toggleMedioActivo(id: string, activo: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("medios").update({ activo }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateMedioTier(
  clientId: string,
  nombreMedio: string,
  input: { tier: number | null; ad_value: number | null; alcance?: number | null },
): Promise<Result> {
  const key = tierNorm(nombreMedio);
  if (!key) return { ok: false, error: "El medio no tiene nombre, no se puede asignar tier." };
  if (input.tier !== null && (input.tier < 1 || input.tier > 4)) {
    return { ok: false, error: "El tier tiene que ser 1, 2, 3 o 4." };
  }
  if (input.ad_value !== null && input.ad_value !== undefined && input.ad_value < 0) {
    return { ok: false, error: "El Ad Value no puede ser negativo." };
  }
  if (input.alcance !== null && input.alcance !== undefined && input.alcance < 0) {
    return { ok: false, error: "El Alcance no puede ser negativo." };
  }
  const supabase = await createClient();

  // Nada de .upsert() aca: el indice unico de `tiers` es sobre (client_id, lower(dominio)) --
  // un indice de expresion. PostgREST solo sabe mandar nombres de columna en onConflict, asi
  // que Postgres no encuentra indice que matchee y devuelve "there is no unique or exclusion
  // constraint matching the ON CONFLICT specification". Se resuelve buscando primero.
  // `key` ya viene en minusculas de tierNorm(), y ilike sin comodines compara exacto pero
  // case-insensitive, igual que el indice.
  const { data: existente, error: findError } = await supabase
    .from("tiers")
    .select("id")
    .eq("client_id", clientId)
    .ilike("dominio", key)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };

  const patch: { medio: string; tier: number | null; ad_value: number | null; alcance?: number | null } = {
    medio: nombreMedio,
    tier: input.tier,
    ad_value: input.ad_value,
  };
  if (input.alcance !== undefined) patch.alcance = input.alcance;

  const { error } = existente
    ? await supabase.from("tiers").update(patch).eq("id", existente.id)
    : await supabase.from("tiers").insert({ client_id: clientId, dominio: key, ...patch });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- Palabras clave ----------

export type KeywordRow = {
  id: string;
  keyword: string;
  grupo: string;
  activa: boolean;
  notas: string | null;
};

export async function listKeywords(clientId: string): Promise<Result<KeywordRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kw_keywords")
    .select("id, keyword, grupo, activa, notas")
    .eq("client_id", clientId)
    .order("keyword", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as KeywordRow[] };
}

export async function addKeyword(
  clientId: string,
  input: { keyword: string; grupo: string },
): Promise<Result> {
  const keyword = input.keyword.trim();
  const grupo = input.grupo.trim();
  if (!keyword) return { ok: false, error: "Falta la palabra clave." };
  if (!grupo) return { ok: false, error: "Elegí a qué sección pertenece." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("kw_keywords")
    .insert({ client_id: clientId, keyword, grupo, activa: true });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Esa palabra clave ya existe para este cliente." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function toggleKeywordActiva(id: string, activa: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("kw_keywords").update({ activa }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- Secciones ----------

export type SeccionRow = {
  id: string;
  nombre: string;
  orden: number;
  es_exclusiva: boolean;
  muestra_ad_value: boolean;
  activa: boolean;
  keywords_count: number;
};

export async function listSecciones(clientId: string): Promise<Result<SeccionRow[]>> {
  const supabase = await createClient();
  const [{ data: secciones, error }, { data: keywords, error: kwError }] = await Promise.all([
    supabase
      .from("secciones")
      .select("id, nombre, orden, es_exclusiva, muestra_ad_value, activa")
      .eq("client_id", clientId)
      .order("orden", { ascending: true }),
    supabase.from("kw_keywords").select("grupo").eq("client_id", clientId),
  ]);
  if (error) return { ok: false, error: error.message };
  if (kwError) return { ok: false, error: kwError.message };

  const countByGrupo = new Map<string, number>();
  for (const k of keywords ?? []) {
    const key = (k.grupo || "").trim().toLowerCase();
    countByGrupo.set(key, (countByGrupo.get(key) ?? 0) + 1);
  }
  const rows: SeccionRow[] = (secciones ?? []).map((s) => ({
    ...s,
    keywords_count: countByGrupo.get(s.nombre.trim().toLowerCase()) ?? 0,
  }));
  return { ok: true, data: rows };
}

// El cliente puede crear secciones (decision de Adrian, 07/08/2026), pero SIEMPRE con al
// menos una keyword apuntandole -- una seccion sin keywords queda siempre vacia en el mail,
// y desde afuera parece que el sistema esta roto. No se expone borrado ni renombre de
// secciones existentes: son staff-only porque el nombre es la clave que usa n8n para armar
// el mail (Build HTML Email + mapa keyword->grupo); tocarlo deja notas sin destino.
export async function addSeccion(
  clientId: string,
  nombre: string,
  keywordIds: string[],
): Promise<Result> {
  const nombreTrim = nombre.trim();
  if (!nombreTrim) return { ok: false, error: "Falta el nombre de la sección." };
  if (!keywordIds.length) {
    return { ok: false, error: "Elegí al menos una palabra clave para esta sección — sin eso queda siempre vacía." };
  }

  const supabase = await createClient();
  const { data: maxRow } = await supabase
    .from("secciones")
    .select("orden")
    .eq("client_id", clientId)
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrden = (maxRow?.orden ?? 0) + 1;

  const { error: insError } = await supabase
    .from("secciones")
    .insert({ client_id: clientId, nombre: nombreTrim, orden: nextOrden });
  if (insError) {
    if (insError.code === "23505") return { ok: false, error: "Ya existe una sección con ese nombre." };
    return { ok: false, error: insError.message };
  }

  const { error: updError } = await supabase
    .from("kw_keywords")
    .update({ grupo: nombreTrim })
    .in("id", keywordIds)
    .eq("client_id", clientId);
  if (updError) return { ok: false, error: `La sección se creó, pero no se pudieron asignar las keywords: ${updError.message}` };

  return { ok: true };
}

export async function toggleSeccionActiva(id: string, activa: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("secciones").update({ activa }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- Google Alerts (KET-46, staff-only — RLS lo bloquea igual para rol cliente) ----------

export type AlertRow = { id: string; tema: string; url_rss: string; activa: boolean; notas: string | null };

export async function listGoogleAlerts(clientId: string): Promise<Result<AlertRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("google_alerts")
    .select("id, tema, url_rss, activa, notas")
    .eq("client_id", clientId)
    .order("tema", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as AlertRow[] };
}

export async function addGoogleAlert(
  clientId: string,
  input: { tema: string; url_rss: string },
): Promise<Result> {
  const tema = input.tema.trim();
  const urlRss = input.url_rss.trim();
  if (!tema) return { ok: false, error: "Falta el tema." };
  if (!/^https?:\/\//i.test(urlRss)) return { ok: false, error: "La URL del RSS no es válida." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("google_alerts")
    .insert({ client_id: clientId, tema, url_rss: urlRss, activa: true });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya existe una alerta con esa URL para este cliente." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function toggleGoogleAlertActiva(id: string, activa: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("google_alerts").update({ activa }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- Seguimiento de medios (KET-46) ----------
//
// Caso distinto de medios_bloqueados (el scraper intento y fallo tecnicamente) y de
// notas_descartadas (la nota SI se encontro pero se filtro). Este es para cuando el cliente
// avisa por fuera del sistema ("nos dijeron que X medio deberia haber salido y no salio")
// y no hay nada que el sistema haya podido registrar solo. Staff-only.

export type SeguimientoRow = {
  id: string;
  medio: string;
  descripcion: string;
  estado: "pendiente" | "en_revision" | "resuelto" | "descartado";
  resolucion: string | null;
  created_at: string;
  resuelto_at: string | null;
};

export async function listSeguimiento(clientId: string): Promise<Result<SeguimientoRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("medios_seguimiento")
    .select("id, medio, descripcion, estado, resolucion, created_at, resuelto_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as SeguimientoRow[] };
}

export async function addSeguimiento(
  clientId: string,
  input: { medio: string; descripcion: string },
): Promise<Result> {
  const medio = input.medio.trim();
  const descripcion = input.descripcion.trim();
  if (!medio) return { ok: false, error: "Falta el medio." };
  if (!descripcion) return { ok: false, error: "Contá qué se esperaba y no salió." };
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("medios_seguimiento").insert({
    client_id: clientId,
    medio,
    descripcion,
    created_by: userData.user?.id ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateSeguimientoEstado(
  id: string,
  estado: SeguimientoRow["estado"],
  resolucion?: string,
): Promise<Result> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = { estado, resolucion: resolucion?.trim() || null };
  if (estado === "resuelto" || estado === "descartado") patch.resuelto_at = new Date().toISOString();
  const { error } = await supabase.from("medios_seguimiento").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
