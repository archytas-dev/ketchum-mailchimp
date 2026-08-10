import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import HistorialView, { type ClientTab } from "./HistorialView";
import { fetchHistory } from "./actions";

export const dynamic = "force-dynamic";

export default async function HistorialPage() {
  const supabase = await createClient();
  const [{ effective }, { data: clientRows }, initial] = await Promise.all([
    getEffectiveRole(supabase),
    supabase.from("clients").select("id, slug, nombre").order("nombre"),
    fetchHistory({ limit: 40, offset: 0 }),
  ]);
  const isStaff = isStaffRole(effective);
  // Mismo criterio que Principal/Base de Datos/Actividad: el cliente no debe ni saber que
  // los *-test existen (TDD §8.3) -- se filtraban acá solo por RLS (invisibles al elegirlos,
  // pero seguían apareciendo en el selector).
  const clients = ((clientRows ?? []) as ClientTab[]).filter((c) => isStaff || !c.slug.endsWith("-test"));
  return (
    <HistorialView
      clients={clients}
      initialRows={initial.rows}
      initialHasMore={initial.hasMore}
    />
  );
}
