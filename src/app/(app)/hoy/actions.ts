"use server";

import { createClient } from "@/lib/supabase/server";

// Resumen IA — MISMO prompt/modelo que el mail de n8n (gpt-4o-mini, temp 0.4, json_object),
// pero sobre las notas EDITADAS por el cliente en el momento. Solo Booking y BMS.
type Seccion = { titulo?: string; notas?: { titulo?: string; medio?: string; snippet?: string }[] };
// exKey/coKey = secciones a sintetizar por cliente; coLabel = nombre del 2º eje en el prompt.
const RESUMEN_CFG: Record<string, { term: string; exKey: string; coKey: string; coLabel: string }> = {
  booking: { term: "Booking.com", exKey: "Exclusiva", coKey: "Competencia", coLabel: "COMPETENCIA" },
  bms: { term: "Bristol Myers Squibb (BMS)", exKey: "Notas Exclusivas", coKey: "Competencia", coLabel: "COMPETENCIA" },
  msd: { term: "MSD Salud Animal", exKey: "Exclusivas", coKey: "Corporativas", coLabel: "CORPORATIVAS" },
  mars: { term: "Mars", exKey: "Exclusivas", coKey: "Competencia", coLabel: "COMPETENCIA" },
};

export async function generateResumen(
  slug: string,
  sections: Seccion[],
): Promise<{ exclusivas: string; competencia: string }> {
  const empty = { exclusivas: "", competencia: "" };
  const cfg = RESUMEN_CFG[slug];
  const key = process.env.OPENAI_API_KEY;
  if (!cfg || !key) return empty;

  const strip = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  const pick = (title: string) => {
    const sec = (sections || []).find(
      (s) => String(s.titulo ?? "").trim().toLowerCase() === title.toLowerCase(),
    );
    return (sec?.notas ?? [])
      .map((n) => ({ titulo: strip(n.titulo), medio: strip(n.medio), snippet: strip(n.snippet) }))
      .filter((n) => n.titulo);
  };
  const ex = pick(cfg.exKey), co = pick(cfg.coKey);
  if (ex.length + co.length === 0) return empty;

  const fmt = (arr: { titulo: string; medio: string; snippet: string }[]) =>
    arr.slice(0, 12).map((n, i) => `[${i + 1}] ${n.titulo}${n.medio ? ` (${n.medio})` : ""}\n${n.snippet.slice(0, 500)}`).join("\n\n");
  const ctx = "EXCLUSIVAS:\n" + (ex.length ? fmt(ex) : "(ninguna)") + `\n\n${cfg.coLabel}:\n` + (co.length ? fmt(co) : "(ninguna)");
  const sys = `Sos analista de PR para ${cfg.term}. Recibís las notas de hoy separadas en EXCLUSIVAS y ${cfg.coLabel} (título + snippet). REGLA OBLIGATORIA: para CADA eje que reciba al menos UNA nota, DEBÉS devolver un párrafo NO vacío (2 a 4 oraciones) que sintetice esas notas, aunque sea una sola nota o te parezcan menores — resumí lo que haya, agrupando las del mismo hecho (no las repitas). No enumeres, no repitas los títulos textualmente, no saludes, no uses la palabra "hoy". Devolvé UN objeto JSON {"exclusivas":"<parrafo o cadena vacia>","competencia":"<parrafo o cadena vacia>"} (la clave "competencia" corresponde a ${cfg.coLabel}). Devolvé cadena vacía SOLO si el eje no recibió NINGUNA nota; si recibió aunque sea una, el párrafo NO puede ir vacío.`;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: ctx }],
      }),
    });
    if (!resp.ok) return empty;
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    const obj = JSON.parse(raw);
    return { exclusivas: String(obj.exclusivas || ""), competencia: String(obj.competencia || "") };
  } catch {
    return empty;
  }
}

// Autosave del estado del editor (refresh-safe). Best-effort: nunca rompe la edición.
export async function saveEditorState(
  clippingId: string,
  editorState: unknown,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("clippings")
    .update({ editor_state: editorState })
    .eq("id", clippingId);
  return { ok: !error };
}

// Al Copiar para Mail: guardar snapshot HTML + estado + marcar exportado + registrar actividad.
export async function exportClip(
  clippingId: string,
  html: string,
  editorState: unknown,
  resumen?: { exclusivas: string; competencia: string },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado" };

  await supabase.from("clippings").update({ editor_state: editorState }).eq("id", clippingId);
  const { error } = await supabase.from("exports").upsert(
    { clipping_id: clippingId, user_id: user.id, html, updated_at: new Date().toISOString() },
    { onConflict: "clipping_id,user_id" },
  );
  if (error) return { ok: false, error: error.message };
  await supabase.from("clippings").update({ estado: "exportado" }).eq("id", clippingId);
  await supabase
    .from("activity")
    .insert({ clipping_id: clippingId, user_id: user.id, accion: "exporta" });

  // Resumen IA: guardar versión (historial + stats). texto = JSON {exclusivas, competencia}.
  if (resumen && (resumen.exclusivas?.trim() || resumen.competencia?.trim())) {
    const { count } = await supabase
      .from("summaries")
      .select("id", { count: "exact", head: true })
      .eq("clipping_id", clippingId);
    await supabase.from("summaries").insert({
      clipping_id: clippingId,
      texto: JSON.stringify(resumen),
      version: (count ?? 0) + 1,
    });
    await supabase
      .from("activity")
      .insert({ clipping_id: clippingId, user_id: user.id, accion: "resumen" });
  }
  return { ok: true };
}
