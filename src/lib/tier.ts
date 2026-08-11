// Antes el Tier de un medio era texto plano ("Tier 1" / "Sin asignar"), idéntico
// visualmente sin importar si el medio vale $41M de Ad Value o nada. Este mapeo
// centraliza el color por nivel para que la jerarquía de valor se vea de un vistazo
// en cualquier tabla de medios (Base de Datos, y donde se sume después).

export type TierValue = 1 | 2 | 3 | 4 | null;

// Mismo algoritmo que usa n8n (nodo "Build Tier Lookup" de los workflows v3) para pasar de
// nombre de medio a la clave de la tabla `tiers`. Copiado literal desde el Code node: si se
// reimplementa desde la descripcion de negocio se pierde el ajuste (ver TDD). El Excel de
// Fedra no tiene columna de dominio, solo nombre de medio.
// Vive aca -- y no en el actions.ts de una pantalla -- porque lo necesitan Base de Datos y
// Precarga por igual, y tiene que ser exactamente el mismo en las dos.
export function tierNorm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(online|web|com|ar|digital|diario|portal|noticias|el|la|los|las)\b/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export const TIER_LABEL: Record<string, string> = {
  "1": "Tier 1",
  "2": "Tier 2",
  "3": "Tier 3",
  "4": "Tier 4",
  none: "Sin asignar",
};

const CLASSES: Record<string, string> = {
  "1": "bg-tier-1-bg text-tier-1",
  "2": "bg-tier-2-bg text-tier-2",
  "3": "bg-tier-3-bg text-tier-3",
  "4": "bg-tier-4-bg text-tier-4",
  none: "bg-tier-none-bg text-tier-none",
};

const DOT_CLASSES: Record<string, string> = {
  "1": "bg-tier-1",
  "2": "bg-tier-2",
  "3": "bg-tier-3",
  "4": "bg-tier-4",
  none: "bg-tier-none",
};

function keyOf(tier: TierValue): string {
  return tier ? String(tier) : "none";
}

export function tierLabel(tier: TierValue): string {
  return TIER_LABEL[keyOf(tier)];
}

export function tierBadgeClasses(tier: TierValue): string {
  return CLASSES[keyOf(tier)];
}

export function tierDotClasses(tier: TierValue): string {
  return DOT_CLASSES[keyOf(tier)];
}
