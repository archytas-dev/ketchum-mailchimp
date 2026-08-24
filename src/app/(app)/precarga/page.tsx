import { createClient } from "@/lib/supabase/server";
import { ordenarClientes } from "@/lib/clientes";
import PrecargaClient, { type ClientOpt } from "./PrecargaClient";

export const dynamic = "force-dynamic";

export default async function PrecargaPage() {
  const supabase = await createClient();
  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  // [19/08] Cutover: notes_precarga (lo que se guarda) va con el client_id real -- los 4
  // nodos "Leer Precarga Pendiente" de n8n ya se corrigieron para leer de ahí. Pero
  // medios/tiers (el catálogo que autocompleta el campo Medio) sigue viviendo bajo el
  // client_id BASE, así que acá se pasa la lista SIN filtrar -- PrecargaClient necesita el
  // par completo para resolver configClientId. El filtro a solo no-legado se hace en el
  // dropdown.
  const clients = ordenarClientes((clientRows ?? []) as ClientOpt[]);

  return (
    // Ancho completo, mismo criterio que Base de Datos: con max-w quedaba angosto mientras
    // sobraba viewport a los costados.
    <div className="w-full p-6">
      <h1 className="text-xl font-semibold mb-1">Precargar notas</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Cargá notas para una fecha futura. Cuando el clipping de ese día corra, entran junto a lo que
        encuentre, sin duplicar (si coincide una, se conserva la precargada).
      </p>
      <PrecargaClient clients={clients} />
    </div>
  );
}
