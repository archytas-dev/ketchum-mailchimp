// Antes el Tier de un medio era texto plano ("Tier 1" / "Sin asignar"), idéntico
// visualmente sin importar si el medio vale $41M de Ad Value o nada. Este mapeo
// centraliza el color por nivel para que la jerarquía de valor se vea de un vistazo
// en cualquier tabla de medios (Base de Datos, y donde se sume después).

export type TierValue = 1 | 2 | 3 | 4 | null;

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
