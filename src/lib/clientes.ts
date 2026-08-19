// [19/08] Cutover: la "Versión Nueva" (slug `*-test`) pasó a ser LA herramienta real —
// los workflows v1/v2 quedaron obsoletos, corriendo en paralelo solo para no perder el
// historial viejo (ver Historial). Los slugs *-test se mantienen tal cual (romper eso
// implica tocar n8n/RLS en varios lugares) pero las 5 pantallas de uso diario (Principal,
// Reportes, Base de Datos, Actividad, Estadísticas) ahora filtran para mostrar SOLO los
// clientes -test. Historial es la única pantalla que sigue mostrando los 8 (ve
// ordenarClientes sin filtrar), para poder consultar lo viejo si hace falta.

export const ORDEN_CLIENTES = ["booking", "bms", "msd", "mars"];

export function esVersionNueva(slug: string): boolean {
  return slug.endsWith("-test");
}

/** Slug del cliente base: `booking-test` -> `booking`. */
export function slugBase(slug: string): string {
  return slug.replace(/-test$/, "");
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
 * Estadísticas): solo la herramienta real (-test) desde el cutover del 19/08.
 */
export function ordenarClientesActivos<T extends { slug: string }>(clients: T[]): T[] {
  return ordenarClientes(clients.filter((c) => esVersionNueva(c.slug)));
}
