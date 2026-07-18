"use server";

import { createClient } from "@/lib/supabase/server";
import { renderClipping, type Article } from "@/lib/render";

export type HistRow = {
  id: string;
  client_id: string;
  nombre: string;
  fecha: string;
  estado: string;
  exportada: boolean; // exportada por ESTE usuario
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const limit = Math.min(opts.limit ?? 40, 100);
  const offset = opts.offset ?? 0;

  let q = supabase
    .from("clippings")
    .select("id, client_id, fecha, estado, clients(nombre)")
    .lte("fecha", todayAR()) // historial = hasta hoy inclusive (hoy también está en Principal)
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
  const page = raw.slice(0, limit);

  // Qué clippings de esta página exportó ESTE usuario (tag "Exportado" es per-user).
  const exportadas = new Set<string>();
  if (user && page.length) {
    const { data: exps } = await supabase
      .from("exports")
      .select("clipping_id")
      .eq("user_id", user.id)
      .in(
        "clipping_id",
        page.map((r) => r.id),
      );
    for (const e of (exps ?? []) as { clipping_id: string }[]) exportadas.add(e.clipping_id);
  }

  const rows: HistRow[] = page.map((r) => {
    const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
    return {
      id: r.id,
      client_id: r.client_id,
      nombre: c?.nombre ?? "—",
      fecha: r.fecha,
      estado: r.estado,
      exportada: exportadas.has(r.id),
    };
  });
  return { rows, hasMore };
}

// __tierNorm: misma normalización que el render (para mapear ad_value por medio).
function tierNorm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(online|web|com|ar|digital|diario|portal|noticias|el|la|los|las)\b/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

// Contenido de un día:
//  - si ESTE usuario exportó -> HTML exportado real (exported=true, tag "Exportado")
//  - si no -> se reconstruye el clipping base que generó n8n desde las notas (exported=false)
export async function fetchExport(clippingId: string): Promise<{
  ok: boolean;
  html: string | null;
  notas: number;
  exported: boolean;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Export propio (per-user).
  const { data: exp } = user
    ? await supabase
        .from("exports")
        .select("html")
        .eq("clipping_id", clippingId)
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle()
    : { data: null };

  const { count: incluidas } = await supabase
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("clipping_id", clippingId)
    .eq("incluida", true);

  if (exp?.html) {
    return { ok: true, html: exp.html, notas: incluidas ?? 0, exported: true };
  }

  // Base: reconstruir desde notas + resumen_ia con el mismo render del cliente.
  const { data: clip } = await supabase
    .from("clippings")
    .select("resumen_ia, clients(slug)")
    .eq("id", clippingId)
    .limit(1)
    .maybeSingle();
  const clientRel = (clip as { clients?: { slug: string } | { slug: string }[] } | null)?.clients;
  const slug = (Array.isArray(clientRel) ? clientRel[0]?.slug : clientRel?.slug) ?? "";

  const { data: notesRaw } = await supabase
    .from("notes")
    .select("seccion, medio, titulo, snippet, url, pub_date, ad_value, incluida, orden")
    .eq("clipping_id", clippingId)
    .eq("incluida", true)
    .order("orden", { ascending: true });

  const notes = (notesRaw ?? []) as {
    seccion: string | null;
    medio: string | null;
    titulo: string | null;
    snippet: string | null;
    url: string | null;
    pub_date: string | null;
    ad_value: number | null;
  }[];

  if (!notes.length) return { ok: true, html: null, notas: 0, exported: false };

  const articles: Article[] = notes.map((n) => ({
    title: n.titulo ?? "",
    snippet: n.snippet ?? "",
    medio: n.medio ?? "",
    grupo: n.seccion ?? "",
    url: n.url ?? "",
    pubDate: n.pub_date ?? "",
  }));

  const tier: Record<string, { ad_value?: number }> = {};
  for (const n of notes) {
    if (n.ad_value && n.medio) tier[tierNorm(n.medio)] = { ad_value: n.ad_value };
  }

  const resumenObj = clip?.resumen_ia as { exclusivas?: string; competencia?: string } | null;
  const html =
    renderClipping(slug, {
      articles,
      tier,
      resumen: resumenObj ?? undefined,
    }) ?? genericHtml(notes); // cliente sin render propio (ej. MARS): lista simple agrupada

  return { ok: true, html, notas: notes.length, exported: false };
}

// Fallback cuando el cliente no tiene render dedicado: lista agrupada por sección, solo lectura.
function esc(s: string): string {
  return String(s || "").replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
function genericHtml(
  notes: { seccion: string | null; medio: string | null; titulo: string | null; url: string | null }[],
): string {
  const grupos = new Map<string, typeof notes>();
  for (const n of notes) {
    const k = n.seccion || "Sin sección";
    const arr = grupos.get(k) ?? [];
    arr.push(n);
    grupos.set(k, arr);
  }
  let h = '<div style="font-family:system-ui,sans-serif;padding:16px;max-width:720px">';
  for (const [sec, arr] of grupos) {
    h += `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#243f55;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin:18px 0 8px">${esc(sec)}</h3>`;
    for (const n of arr) {
      const t = esc(n.titulo || "");
      const m = n.medio ? `<span style="color:#64748b"> — ${esc(n.medio)}</span>` : "";
      h += n.url
        ? `<p style="margin:6px 0"><a href="${esc(n.url)}" target="_blank" style="color:#1d4ed8;text-decoration:none">${t}</a>${m}</p>`
        : `<p style="margin:6px 0">${t}${m}</p>`;
    }
  }
  return h + "</div>";
}
