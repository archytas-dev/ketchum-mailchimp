"use server";

import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

// "Casi entraron" -> agregar directo al clipping de HOY, no vía Precarga. Precarga solo se
// mezcla cuando n8n llama import_clipping(p_fecha=X) -- si el pipeline de hoy ya corrió,
// una precarga con fecha=hoy queda huérfana para siempre (mañana el RPC busca fecha=mañana,
// nunca vuelve a mirar la de hoy). Insertar directo en `notes` con origen='cliente' es el
// mismo patrón que ya usa import_clipping para precarga -- misma trazabilidad para el
// futuro Panel PM ("agregadas a mano: notes.origen='cliente'").
export async function agregarDescartadaAClipping(descartadaId: string, clientId: string): Promise<Result> {
  const supabase = await createClient();

  const { data: descartada, error: errDescartada } = await supabase
    .from("notas_descartadas")
    .select("titulo, url, medio")
    .eq("id", descartadaId)
    .single();
  if (errDescartada || !descartada) return { ok: false, error: "No se encontró la nota descartada." };

  const { data: clip, error: errClip } = await supabase
    .from("clippings")
    .select("id")
    .eq("client_id", clientId)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errClip) return { ok: false, error: errClip.message };
  if (!clip) return { ok: false, error: "Este cliente todavía no tiene ningún clipping generado." };

  const { data: ordenRows } = await supabase
    .from("notes")
    .select("orden")
    .eq("clipping_id", clip.id)
    .order("orden", { ascending: false })
    .limit(1);
  const nuevoOrden = (ordenRows?.[0]?.orden ?? 0) + 1;

  const { error: errInsert } = await supabase.from("notes").insert({
    clipping_id: clip.id,
    seccion: null,
    medio: descartada.medio,
    titulo: descartada.titulo,
    snippet: null, // notas_descartadas no guarda snippet -- se puede completar a mano en el editor.
    url: descartada.url,
    pub_date: null,
    orden: nuevoOrden,
    incluida: true,
    origen: "cliente",
  });
  if (errInsert) return { ok: false, error: errInsert.message };

  await supabase.from("notas_descartadas").update({ recuperada: true }).eq("id", descartadaId);

  return { ok: true };
}
