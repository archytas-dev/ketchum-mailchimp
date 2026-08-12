"use server";

import { createClient } from "@/lib/supabase/server";
import { renderClipping, hasRenderer, type Article } from "@/lib/render";
import { alertarErrorSlack } from "@/lib/alertar-error";

type NoteRow = {
  id: string;
  seccion: string | null;
  medio: string | null;
  titulo: string;
  snippet: string | null;
  url: string | null;
  pub_date: string | null;
  orden: number;
};

export async function exportClipping(
  clippingId: string,
): Promise<{ ok: boolean; html?: string; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado" };

  const { data: clipping } = await supabase
    .from("clippings")
    .select("id, clients(slug)")
    .eq("id", clippingId)
    .single();
  if (!clipping) return { ok: false, error: "Clipping no encontrado" };

  const client = Array.isArray(clipping.clients)
    ? clipping.clients[0]
    : clipping.clients;
  const slug = client?.slug ?? "";

  if (!hasRenderer(slug)) {
    return { ok: false, error: `Sin render para ${slug || "este cliente"}` };
  }

  // Notas incluidas, en orden — leídas con la sesión del usuario (RLS).
  const { data: notes } = await supabase
    .from("notes")
    .select("id, seccion, medio, titulo, snippet, url, pub_date, orden")
    .eq("clipping_id", clippingId)
    .eq("incluida", true)
    .order("orden", { ascending: true });

  const articles: Article[] = (notes ?? []).map((n: NoteRow) => ({
    id: n.id,
    title: n.titulo,
    snippet: n.snippet ?? "",
    medio: n.medio ?? "",
    grupo: n.seccion ?? "",
    url: n.url ?? "",
    pubDate: n.pub_date ?? "",
  }));

  // Copia para el mail: sin el resumen IA (ese va aparte en la plataforma).
  const html = renderClipping(slug, { articles, resumen: {} }) ?? "";

  const { error: errExport } = await supabase.from("exports").upsert(
    {
      clipping_id: clippingId,
      user_id: user.id,
      html,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clipping_id,user_id" },
  );
  if (errExport) await alertarErrorSlack("Guardar export (clipping)", errExport);

  const { error: errActivity } = await supabase
    .from("activity")
    .insert({ clipping_id: clippingId, user_id: user.id, accion: "exporta" });
  if (errActivity) await alertarErrorSlack("Registrar actividad de export (clipping)", errActivity);

  const { error: errEstado } = await supabase
    .from("clippings")
    .update({ estado: "exportado" })
    .eq("id", clippingId);
  if (errEstado) await alertarErrorSlack("Marcar clipping como exportado (clipping)", errEstado);

  return { ok: true, html };
}
