import { createClient } from "@/lib/supabase/server";
import HistorialView, { type ClientTab } from "./HistorialView";
import { fetchHistory } from "./actions";

export const dynamic = "force-dynamic";

export default async function HistorialPage() {
  const supabase = await createClient();
  const [{ data: clientRows }, initial] = await Promise.all([
    supabase.from("clients").select("id, slug, nombre").order("nombre"),
    fetchHistory({ limit: 40, offset: 0 }),
  ]);
  const clients = (clientRows ?? []) as ClientTab[];
  return (
    <HistorialView
      clients={clients}
      initialRows={initial.rows}
      initialHasMore={initial.hasMore}
    />
  );
}
