"use server";

import { createClient } from "@/lib/supabase/server";

type Ok<T = undefined> = { ok: true } & (T extends undefined ? unknown : { data: T });
type Err = { ok: false; error: string };
type Result<T = undefined> = Ok<T> | Err;

// Las constantes y tipos viven en ./tipos.ts -- un modulo "use server" solo puede exportar
// funciones async (ver el comentario de ese archivo).
import { TIPOS_REPORTE, type ReporteRow } from "./tipos";

export async function listReportes(clientId: string): Promise<Result<ReporteRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reportes")
    .select("id, client_id, fecha, tipo, descripcion, nota_url, estado, resolucion, created_at, resuelto_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as ReporteRow[] };
}

export async function addReporte(
  clientId: string,
  input: { fecha: string; tipo: string; descripcion: string; nota_url?: string },
): Promise<Result> {
  const descripcion = input.descripcion.trim();
  if (!descripcion) return { ok: false, error: "Contá qué pasó — sin descripción no se puede investigar." };
  if (!TIPOS_REPORTE.some((t) => t.value === input.tipo)) {
    return { ok: false, error: "Elegí un tipo de error." };
  }
  if (!input.fecha) return { ok: false, error: "Falta la fecha del clipping." };

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  // Si hay un clipping de ese cliente y esa fecha, se enlaza: deja el reporte conectado al
  // envio concreto sin pedirle nada mas a quien reporta.
  const { data: clipping } = await supabase
    .from("clippings")
    .select("id")
    .eq("client_id", clientId)
    .eq("fecha", input.fecha)
    .maybeSingle();

  const { error } = await supabase.from("reportes").insert({
    client_id: clientId,
    user_id: userData.user?.id ?? null,
    clipping_id: clipping?.id ?? null,
    fecha: input.fecha,
    tipo: input.tipo,
    descripcion,
    nota_url: input.nota_url?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Resolver es staff-only por RLS (reportes_update pide is_staff()): el cliente reporta y sigue
// el estado, pero no cierra sus propios reportes.
export async function updateReporteEstado(
  id: string,
  estado: ReporteRow["estado"],
  resolucion?: string,
): Promise<Result> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = { estado };
  if (resolucion !== undefined) patch.resolucion = resolucion.trim() || null;
  if (estado === "resuelto" || estado === "descartado") patch.resuelto_at = new Date().toISOString();
  const { error } = await supabase.from("reportes").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
