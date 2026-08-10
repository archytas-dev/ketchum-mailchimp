import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import PrecargaClient, { type ClientOpt } from "./PrecargaClient";

export const dynamic = "force-dynamic";

const ORDEN = ["booking", "bms", "msd", "mars"];

export default async function PrecargaPage() {
  const supabase = await createClient();
  const { effective } = await getEffectiveRole(supabase);
  const isStaff = isStaffRole(effective);
  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  // El cliente no debe ni saber que los *-test existen (TDD §8.3).
  const clients = ((clientRows ?? []) as ClientOpt[])
    .filter((c) => isStaff || !c.slug.endsWith("-test"))
    .sort((a, b) => {
      const ia = ORDEN.indexOf(a.slug);
      const ib = ORDEN.indexOf(b.slug);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Precargar notas</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Cargá notas para una fecha futura. Cuando el clipping de ese día corra, entran junto a lo que
        encuentre, sin duplicar (si coincide una, se conserva la precargada).
      </p>
      <PrecargaClient clients={clients} />
    </div>
  );
}
