"use server";

import { createClient } from "@/lib/supabase/server";

export type HistRow = {
  id: string;
  client_id: string;
  nombre: string;
  fecha: string;
  estado: string;
};

function todayAR(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Lista paginada (metadata liviana: sin html ni notas). Para no traer 100 días de golpe.
export async function fetchHistory(opts: {
  clientId?: string;
  desde?: string;
  hasta?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: HistRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const limit = Math.min(opts.limit ?? 40, 100);
  const offset = opts.offset ?? 0;

  let q = supabase
    .from("clippings")
    .select("id, client_id, fecha, estado, clients(nombre)")
    .lt("fecha", todayAR()) // historial = días anteriores a hoy (hoy está en Principal)
    .order("fecha", { ascending: false })
    .range(offset, offset + limit); // pido uno de más para saber si hay más

  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  if (opts.desde) q = q.gte("fecha", opts.desde);
  if (opts.hasta) q = q.lte("fecha", opts.hasta);

  const { data } = await q;
  const raw = (data ?? []) as unknown as {
    id: string;
    client_id: string;
    fecha: string;
    estado: string;
    clients: { nombre: string } | { nombre: string }[] | null;
  }[];

  const hasMore = raw.length > limit;
  const rows: HistRow[] = raw.slice(0, limit).map((r) => {
    const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
    return { id: r.id, client_id: r.client_id, nombre: c?.nombre ?? "—", fecha: r.fecha, estado: r.estado };
  });
  return { rows, hasMore };
}

// HTML exportado (lo que se copió al mail) de un día — on-demand al seleccionarlo.
export async function fetchExport(
  clippingId: string,
): Promise<{ ok: boolean; html: string | null; notas: number }> {
  const supabase = await createClient();
  const [{ data: exp }, { count }] = await Promise.all([
    supabase.from("exports").select("html").eq("clipping_id", clippingId).limit(1).maybeSingle(),
    supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("clipping_id", clippingId)
      .eq("incluida", true),
  ]);
  return { ok: true, html: exp?.html ?? null, notas: count ?? 0 };
}
