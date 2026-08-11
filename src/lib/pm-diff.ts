// Panel PM (TDD §8.2): compara BASE (lo que enviamos, notes.origen='n8n') contra FINAL (lo que
// el cliente terminó dejando en su editor, user_clipping_state.editor_state via get_pm_final_state).
// El match es por URL normalizada -- mismo criterio que el dedup de n8n (§13.4), reimplementado
// acá porque corre en la app, no en el workflow.

export function normalizeUrlForDiff(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  try {
    const withoutWww = trimmed.replace(/^(https?:\/\/)www\./i, "$1");
    const url = new URL(withoutWww);
    for (const k of [...url.searchParams.keys()]) {
      if (k.startsWith("utm_") || ["gclid", "fbclid", "ref", "ref_src"].includes(k)) {
        url.searchParams.delete(k);
      }
    }
    url.pathname = url.pathname.replace(/\/amp\/?$/i, "").replace(/\/+$/, "");
    return url.toString().toLowerCase();
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^(https?:\/\/)www\./i, "$1")
      .replace(/\/+$/, "");
  }
}

// El editor guarda el resaltado de marca dentro del texto (editor.js pinta con foreColor
// #D32F2F), asi que un titulo "sin tocar" puede venir como
// `... busquedas en <span style="color:rgb(211, 47, 47)">Booking</span> ...`.
// Para mostrar y para comparar contenido nos interesa el texto pelado; el markup se compara
// aparte para poder distinguir "solo pinto la marca" de una edicion real (ver DiffRow.soloFormato).
export function stripHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type BaseNote = {
  id: string;
  url: string | null;
  titulo: string;
  medio: string | null;
  seccion: string | null;
  snippet: string | null;
};

export type FinalNote = {
  url: string;
  titulo: string;
  medio: string | null;
  seccion: string | null;
  snippet: string | null;
};

export type DiffTipo = "rojo" | "verde" | "amarillo_nueva" | "amarillo_editada";

export type DiffRow = {
  urlNorm: string;
  tipo: DiffTipo;
  base?: BaseNote;
  final?: FinalNote;
  descartada?: { fase: string; motivo: string } | null;
  // Solo en amarillo_editada: el texto pelado quedo igual y lo unico que cambio fue el
  // resaltado de la marca. Se sigue mostrando, pero etiquetada aparte para no leerla como
  // una correccion de contenido.
  soloFormato?: boolean;
  // Que campos cambiaron, para el desplegable de dos columnas.
  campos?: ("titulo" | "snippet" | "seccion")[];
};

// editor_state guardado usa `sections` (ver src/lib/clip/editor.js normalize()); cada nota trae
// título/url/medio/snippet ya resueltos por toNota().
export function flattenEditorState(editorState: unknown): FinalNote[] {
  if (!editorState || typeof editorState !== "object") return [];
  const sections = (editorState as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return [];
  const out: FinalNote[] = [];
  for (const s of sections) {
    if (!s || typeof s !== "object") continue;
    const seccionTitulo = String((s as { titulo?: unknown }).titulo ?? "");
    const notas = (s as { notas?: unknown }).notas;
    if (!Array.isArray(notas)) continue;
    for (const n of notas) {
      if (!n || typeof n !== "object") continue;
      const url = String((n as { url?: unknown }).url ?? "").trim();
      if (!url) continue;
      out.push({
        url,
        titulo: String((n as { titulo?: unknown }).titulo ?? ""),
        medio: ((n as { medio?: unknown }).medio as string) ?? null,
        seccion: seccionTitulo || null,
        snippet: ((n as { snippet?: unknown }).snippet as string) ?? null,
      });
    }
  }
  return out;
}

export function computeDiff(
  base: BaseNote[],
  finalNotes: FinalNote[] | null,
  descartadasPorUrl: Map<string, { fase: string; motivo: string }>,
): DiffRow[] {
  // Sin editor_state guardado por el cliente todavía: nada para comparar (no es que todo sea rojo).
  if (finalNotes === null) return [];

  const baseByUrl = new Map<string, BaseNote>();
  for (const b of base) {
    const u = normalizeUrlForDiff(b.url);
    if (u) baseByUrl.set(u, b);
  }
  const finalByUrl = new Map<string, FinalNote>();
  for (const f of finalNotes) {
    const u = normalizeUrlForDiff(f.url);
    if (u) finalByUrl.set(u, f);
  }

  const rows: DiffRow[] = [];

  for (const [u, b] of baseByUrl) {
    const f = finalByUrl.get(u);
    if (!f) {
      rows.push({ urlNorm: u, tipo: "rojo", base: b });
      continue;
    }
    const campos: ("titulo" | "snippet" | "seccion")[] = [];
    if (f.titulo !== b.titulo) campos.push("titulo");
    if (f.snippet !== b.snippet) campos.push("snippet");
    if (f.seccion !== b.seccion) campos.push("seccion");
    if (!campos.length) continue;
    const soloFormato =
      f.seccion === b.seccion &&
      stripHtml(f.titulo) === stripHtml(b.titulo) &&
      stripHtml(f.snippet) === stripHtml(b.snippet);
    rows.push({ urlNorm: u, tipo: "amarillo_editada", base: b, final: f, soloFormato, campos });
  }
  for (const [u, f] of finalByUrl) {
    if (baseByUrl.has(u)) continue;
    const d = descartadasPorUrl.get(u) ?? null;
    rows.push({ urlNorm: u, tipo: d ? "amarillo_nueva" : "verde", final: f, descartada: d });
  }

  return rows;
}

export type DiffStats = {
  enviadas: number;
  totalFinal: number;
  rojas: number;
  verdes: number;
  amarillasNuevas: number;
  amarillasEditadas: number;
  // Subconjunto de amarillasEditadas donde lo unico que cambio fue el resaltado de la marca.
  amarillasSoloFormato: number;
  agregadas: number;
  editadas: number;
  precision: number | null;
  cobertura: number | null;
};

export function computeStats(base: BaseNote[], finalNotes: FinalNote[] | null, rows: DiffRow[]): DiffStats {
  const enviadas = base.length;
  const totalFinal = finalNotes?.length ?? 0;
  const rojas = rows.filter((r) => r.tipo === "rojo").length;
  const verdes = rows.filter((r) => r.tipo === "verde").length;
  const amarillasNuevas = rows.filter((r) => r.tipo === "amarillo_nueva").length;
  const amarillasEditadas = rows.filter((r) => r.tipo === "amarillo_editada").length;
  const amarillasSoloFormato = rows.filter((r) => r.tipo === "amarillo_editada" && r.soloFormato).length;
  return {
    enviadas,
    totalFinal,
    rojas,
    verdes,
    amarillasNuevas,
    amarillasEditadas,
    amarillasSoloFormato,
    agregadas: verdes + amarillasNuevas,
    editadas: amarillasEditadas,
    precision: enviadas > 0 ? (enviadas - rojas) / enviadas : null,
    cobertura: totalFinal > 0 ? (enviadas - rojas) / totalFinal : null,
  };
}
