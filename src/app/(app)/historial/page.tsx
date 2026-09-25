import { createClient } from "@/lib/supabase/server";
import { ordenarClientesActivos } from "@/lib/clientes";
import HistorialView, { type ClientTab } from "./HistorialView";
import { fetchHistory } from "./actions";

export const dynamic = "force-dynamic";

export default async function HistorialPage() {
  const supabase = await createClient();
  const [{ data: clientRows }, initial] = await Promise.all([
    supabase.from("clients").select("id, slug, nombre").order("nombre"),
    fetchHistory({ limit: 40, offset: 0 }),
  ]);
  // [19/08] Cutover: los clientes viejos (v1/v2) quedan full ocultos, también acá -- ya no
  // interesan en la herramienta, solo siguen corriendo para el mail a Adrián.
  const clients = ordenarClientesActivos((clientRows ?? []) as ClientTab[]);
  return (
    <HistorialView
      clients={clients}
      initialRows={initial.rows}
      initialHasMore={initial.hasMore}
    />
  );
}
