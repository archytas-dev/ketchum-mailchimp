// Canonicaliza la `seccion` cruda de n8n a la sección que ve el cliente (igual que el editor).
// Mismo criterio que editor.js: exacto → contiene/contenido → fallback por cliente.
const SECTIONS: Record<string, string[]> = {
  booking: ["Exclusiva", "Competencia", "Turismo"],
  bms: [
    "Notas Exclusivas", "Noticias del Sector", "Propiedad Intelectual", "Competencia",
    "Onco Hematología", "CAR-T", "Cardiología", "Artritis", "Psoriasis", "Trasplantes",
  ],
  msd: ["Exclusivas", "Corporativas", "Salud", "Animales de Compañía", "Aves", "Cerdos", "Ganadería", "Innovación en Salud Animal"],
  mars: ["Exclusivas", "Corporativo", "Pet Nutrition", "Snacking", "Competencia", "Noticias de interés"],
};
const FALLBACK: Record<string, string> = {
  booking: "Turismo",
  bms: "Noticias del Sector",
  msd: "Salud",
  mars: "Noticias de interés",
};

// Grupos internos de n8n que no matchean por texto con la sección visible.
const ALIAS: Record<string, Record<string, string>> = {
  bms: {
    "productos bms": "Notas Exclusivas",
    "regulatorio y gobierno": "Noticias del Sector",
    "sector y gestion": "Noticias del Sector",
    // [Cliente 2026-07-17] "Áreas Terapéuticas" es solo encabezado; las notas genéricas van a Noticias del Sector.
    "indicaciones y areas terapeuticas": "Noticias del Sector",
    "areas terapeuticas": "Noticias del Sector",
    "indicaciones": "Noticias del Sector",
  },
};

function fold(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function themeOf(slug: string): string {
  const s = String(slug || "").toLowerCase();
  if (s.includes("bms")) return "bms";
  if (s.includes("msd")) return "msd";
  if (s.includes("mars")) return "mars";
  return "booking";
}

export function canonSection(slug: string, raw: string | null): string {
  const theme = themeOf(slug);
  const cans = SECTIONS[theme] || [];
  const r = fold(raw || "");
  if (!r) return FALLBACK[theme] || cans[cans.length - 1] || "—";
  if (ALIAS[theme] && ALIAS[theme][r]) return ALIAS[theme][r];
  for (const c of cans) if (fold(c) === r) return c;
  const byLen = [...cans].sort((a, b) => fold(b).length - fold(a).length);
  for (const c of byLen) {
    const fc = fold(c);
    if (fc && (r.includes(fc) || fc.includes(r))) return c;
  }
  return FALLBACK[theme] || cans[cans.length - 1] || String(raw);
}
