// [24/08] Rename: el cliente real (antes slug `*-test`) pasó a tener el slug limpio
// (`booking`, `bms`, `msd`, `mars`) y el cliente viejo (v1/v2, antes el slug base) pasó a
// `*-legado`. Los workflows v1/v2 quedaron obsoletos, corriendo en paralelo solo para no
// perder el historial viejo (ver Historial). Las 5 pantallas de uso diario (Principal,
// Reportes, Base de Datos, Actividad, Estadísticas) filtran para mostrar SOLO los
// clientes NO-legado. Historial es la única pantalla que sigue mostrando los 8 (ver
// ordenarClientes sin filtrar), para poder consultar lo viejo si hace falta.

export const ORDEN_CLIENTES = ["booking", "bms", "msd", "mars"];

export function esVersionNueva(slug: string): boolean {
  return !slug.endsWith("-legado");
}

/** Slug del cliente base: `booking-legado` -> `booking`. */
export function slugBase(slug: string): string {
  return slug.replace(/-legado$/, "");
}

/** Orden acordado de clientes: Booking, BMS, MSD, Mars. */
export function ordenarClientes<T extends { slug: string }>(clients: T[]): T[] {
  return [...clients].sort((a, b) => {
    const ia = ORDEN_CLIENTES.indexOf(slugBase(a.slug));
    const ib = ORDEN_CLIENTES.indexOf(slugBase(b.slug));
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return Number(esVersionNueva(a.slug)) - Number(esVersionNueva(b.slug));
  });
}

/**
 * Las 5 pantallas de uso diario (Principal, Reportes, Base de Datos, Actividad,
 * Estadísticas): solo la herramienta real (no-legado) desde el cutover del 19/08.
 */
export function ordenarClientesActivos<T extends { slug: string }>(clients: T[]): T[] {
  return ordenarClientes(clients.filter((c) => esVersionNueva(c.slug)));
}
