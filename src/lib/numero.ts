// [25/08] Feedback del cliente (Cami, Ketchum): en Precarga no se podía cargar un Ad Value en
// millones -- "si es de $ 7.000.000 no puedo cargarlo".
//
// Causa: los campos eran `type="number"`, que sólo acepta el formato numérico del estándar HTML,
// donde el punto es separador DECIMAL y los separadores de miles directamente no existen. Al
// escribir "7.000.000" el navegador considera el valor inválido y `e.target.value` vuelve vacío;
// `Number("7.000.000")` da NaN. Resultado: en Precarga el commit se descartaba en silencio, y en
// Base de Datos era peor -- el NaN se normalizaba a null y PISABA el valor que ya estaba cargado.
//
// Estos helpers permiten escribir el número como se escribe en Argentina (o pegarlo desde Excel,
// que es de donde suele venir). Los dos campos que los usan (alcance int, ad_value bigint) son
// enteros, así que alcanza con quedarse con los dígitos: eso tolera "7.000.000", "7 000 000" y
// "$ 7.000.000" sin inventar reglas de decimales que estos campos no tienen.

/**
 * Convierte lo tipeado a un entero. Ignora separadores de miles, espacios y símbolos de moneda.
 * Devuelve `null` si no quedó ningún dígito (campo vacío o basura), nunca `NaN`.
 */
export function parseNumeroAr(entrada: string | null | undefined): number | null {
  const soloDigitos = String(entrada ?? "").replace(/\D/g, "");
  if (soloDigitos === "") return null;
  const n = Number(soloDigitos);
  // Un pegado accidental de 20 dígitos no puede representarse exacto: mejor null que un valor
  // silenciosamente redondeado.
  return Number.isSafeInteger(n) ? n : null;
}

/** Formatea para mostrar: 7000000 -> "7.000.000". Cadena vacía si no hay valor. */
export function formatNumeroAr(valor: number | null | undefined): string {
  return valor == null ? "" : new Intl.NumberFormat("es-AR").format(valor);
}
