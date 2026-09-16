import { createClient } from "@/lib/supabase/server";
import { ordenarClientes } from "@/lib/clientes";
import { enPlanoV4 } from "@/lib/data-plane";
import PrecargaClient, { type ClientOpt } from "./PrecargaClient";

export const dynamic = "force-dynamic";

export default async function PrecargaPage() {
  const soloLectura = enPlanoV4();
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
      {soloLectura ? (
        <div className="max-w-2xl rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Vista de prueba v4: Precarga está en modo lectura.</p>
          <p className="mt-1 text-amber-900">
            Todavía usa datos compartidos de la v3. La habilitamos cuando tenga su circuito v4 propio.
          </p>
        </div>
      ) : (
        <PrecargaClient clients={clients} />
      )}
    </div>
  );
}
