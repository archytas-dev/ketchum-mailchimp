import { createClient } from "@/lib/supabase/server";
import { ordenarClientes } from "@/lib/clientes";
import HistorialView, { type ClientTab } from "./HistorialView";
import { fetchHistory } from "./actions";

export const dynamic = "force-dynamic";

export default async function HistorialPage() {
  const supabase = await createClient();
  const [{ data: clientRows }, initial] = await Promise.all([
    supabase.from("clients").select("id, slug, nombre").order("nombre"),
    fetchHistory({ limit: 40, offset: 0 }),
  ]);
  // Las dos versiones de cada clipping, la que se envía hoy y la nueva (decisión de Adrián,
  // 11/08). Quién ve qué lo define RLS via user_client_access.
  const clients = ordenarClientes((clientRows ?? []) as ClientTab[]);
  return (
    <HistorialView
      clients={clients}
      initialRows={initial.rows}
      initialHasMore={initial.hasMore}
    />
  );
}
