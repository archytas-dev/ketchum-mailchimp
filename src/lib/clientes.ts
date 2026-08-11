// Cada cliente de Ketchum aparece dos veces en los selectores: la version del clipping que
// se envia hoy ("Booking") y la nueva ("Booking - Version Nueva", slug `booking-test`).
//
// Decision de Adrian (11/08): el cliente ve las DOS, en todas las pantallas. Antes cada
// pantalla filtraba los *-test para el rol cliente por su cuenta, con la misma linea repetida
// seis veces; el acceso real lo controla RLS via user_client_access, no este filtro.

export const ORDEN_CLIENTES = ["booking", "bms", "msd", "mars"];

export function esVersionNueva(slug: string): boolean {
  return slug.endsWith("-test");
}

/** Slug del cliente base: `booking-test` -> `booking`. */
export function slugBase(slug: string): string {
  return slug.replace(/-test$/, "");
}

/**
 * Ordena dejando cada par junto y en el orden acordado de clientes:
 * Booking, Booking - Version Nueva, BMS, BMS - Version Nueva, ...
 */
export function ordenarClientes<T extends { slug: string }>(clients: T[]): T[] {
  return [...clients].sort((a, b) => {
    const ia = ORDEN_CLIENTES.indexOf(slugBase(a.slug));
    const ib = ORDEN_CLIENTES.indexOf(slugBase(b.slug));
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    // Dentro del par, primero la version que se envia hoy.
    return Number(esVersionNueva(a.slug)) - Number(esVersionNueva(b.slug));
  });
}
