"use server";

import { createClient } from "@/lib/supabase/server";
import { tabla } from "@/lib/data-plane";
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

type CambioNota = {
  id: string;
  incluida?: boolean;
  orden?: number;
  pintada?: boolean;
};

const ACCIONES_NOTA = new Set(["quita", "reordena", "pinta", "despinta", "regresa"]);

/**
 * El editor histórico nunca escribe desde el browser: esta acción usa el plano
 * registrado para la sesión y limita cada update al clipping en pantalla.
 */
export async function guardarCambiosNotas(
  clippingId: string,
  cambios: CambioNota[],
  accion: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!ACCIONES_NOTA.has(accion) || cambios.length === 0 || cambios.length > 20) {
    return { ok: false, error: "Cambio no válido" };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado" };

  for (const cambio of cambios) {
    const values: { incluida?: boolean; orden?: number; pintada?: boolean } = {};
    if (typeof cambio.incluida === "boolean") values.incluida = cambio.incluida;
    if (typeof cambio.pintada === "boolean") values.pintada = cambio.pintada;
    if (Number.isInteger(cambio.orden) && cambio.orden! >= 0) values.orden = cambio.orden;
    if (Object.keys(values).length === 0) return { ok: false, error: "Cambio vacío" };

    const { error } = await tabla(supabase, "notes")
      .update(values)
      .eq("id", cambio.id)
      .eq("clipping_id", clippingId);
    if (error) {
      await alertarErrorSlack("Guardar edición histórica", error);
      return { ok: false, error: error.message };
    }
  }

  const { error: activityError } = await tabla(supabase, "activity").insert({
    clipping_id: clippingId,
    user_id: user.id,
    accion,
    note_id: cambios.length === 1 ? cambios[0].id : null,
  });
  if (activityError) await alertarErrorSlack("Registrar actividad histórica", activityError);
  return { ok: true };
}

export async function exportClipping(
  clippingId: string,
): Promise<{ ok: boolean; html?: string; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado" };

  const { data: clipping } = await tabla(supabase, "clippings")
    .select("id, client_id")
    .eq("id", clippingId)
    .single();
  if (!clipping) return { ok: false, error: "Clipping no encontrado" };

  const { data: client } = await supabase
    .from("clients")
    .select("slug")
    .eq("id", clipping.client_id)
    .maybeSingle();
  const slug = client?.slug ?? "";

  if (!hasRenderer(slug)) {
    return { ok: false, error: `Sin render para ${slug || "este cliente"}` };
  }

  // Notas incluidas, en orden — leídas con la sesión del usuario (RLS).
  const { data: notes } = await tabla(supabase, "notes")
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

  const { error: errExport } = await tabla(supabase, "exports").upsert(
    {
      clipping_id: clippingId,
      user_id: user.id,
      html,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clipping_id,user_id" },
  );
  if (errExport) await alertarErrorSlack("Guardar export (clipping)", errExport);

  const { error: errActivity } = await tabla(supabase, "activity")
    .insert({ clipping_id: clippingId, user_id: user.id, accion: "exporta" });
  if (errActivity) await alertarErrorSlack("Registrar actividad de export (clipping)", errActivity);

  const { error: errEstado } = await tabla(supabase, "clippings")
    .update({ estado: "exportado" })
    .eq("id", clippingId);
  if (errEstado) await alertarErrorSlack("Marcar clipping como exportado (clipping)", errEstado);

  return { ok: true, html };
}
