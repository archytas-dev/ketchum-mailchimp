import { createClient } from "@/lib/supabase/server";
import { ordenarClientes } from "@/lib/clientes";
import PrecargaClient, { type ClientOpt } from "./PrecargaClient";

export const dynamic = "force-dynamic";

export default async function PrecargaPage() {
  const supabase = await createClient();
  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  // Las dos versiones de cada clipping, la que se envía hoy y la nueva (decisión de Adrián,
  // 11/08). Quién ve qué lo define RLS via user_client_access.
  const clients = ordenarClientes((clientRows ?? []) as ClientOpt[]);

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
