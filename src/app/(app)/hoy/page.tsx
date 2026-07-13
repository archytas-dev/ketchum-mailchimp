import { createClient } from "@/lib/supabase/server";
import PrincipalClient, { type ClientPayload } from "./PrincipalClient";

export const dynamic = "force-dynamic";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DIAS[dt.getUTCDay()]}, ${String(d).padStart(2, "0")} de ${MESES[m - 1]} ${y}`;
}
function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Orden fijo del desplegable (Booking primero).
const ORDEN = ["booking", "bms", "msd", "mars"];

type ClientRow = { id: string; slug: string; nombre: string };
type NoteRow = {
  id: string;
  clipping_id: string;
  seccion: string | null;
  medio: string | null;
  titulo: string;
  snippet: string | null;
  url: string | null;
  pub_date: string | null;
  orden: number;
};
type ClipRow = { id: string; client_id: string; fecha: string; editor_state: unknown; resumen_ia: unknown };

export default async function HoyPage() {
  const supabase = await createClient();

  const [{ data: clientRows }, { data: clipRows }] = await Promise.all([
    supabase.from("clients").select("id, slug, nombre"),
    // Traé lo ÚLTIMO que se envió por cliente: todos los clippings, más nuevo primero.
    supabase
      .from("clippings")
      .select("id, client_id, fecha, editor_state, resumen_ia")
      .order("fecha", { ascending: false }),
  ]);

  const clients = (clientRows ?? []) as ClientRow[];
  const clips = (clipRows ?? []) as ClipRow[];

  // Último clipping por cliente (el primero que aparece = fecha más nueva).
  const latestByClient = new Map<string, ClipRow>();
  for (const c of clips) if (!latestByClient.has(c.client_id)) latestByClient.set(c.client_id, c);

  const clipIds = [...latestByClient.values()].map((c) => c.id);
  const notesByClip = new Map<string, NoteRow[]>();
  if (clipIds.length) {
    const { data: noteRows } = await supabase
      .from("notes")
      .select("id, clipping_id, seccion, medio, titulo, snippet, url, pub_date, orden")
      .in("clipping_id", clipIds)
      .eq("incluida", true)
      .order("orden", { ascending: true });
    for (const n of (noteRows ?? []) as NoteRow[]) {
      const arr = notesByClip.get(n.clipping_id) ?? [];
      arr.push(n);
      notesByClip.set(n.clipping_id, arr);
    }
  }

  const payloads: ClientPayload[] = clients.map((c) => {
    const clip = latestByClient.get(c.id);
    if (!clip) return { slug: c.slug, nombre: c.nombre, clippingId: null, data: null, fecha: null };
    const fecha = fechaLarga(clip.fecha);
    let data: unknown;
    if (clip.editor_state) {
      // Si el editor ya autoguardó estado pero todavía sin resumen, usar el de n8n (resumen_ia).
      const es = clip.editor_state as { resumen?: unknown } | null;
      const esResumen = es && typeof es === "object" ? es.resumen : undefined;
      const tieneResumen =
        esResumen && typeof esResumen === "object" &&
        (String((esResumen as { exclusivas?: unknown }).exclusivas ?? "").trim() ||
          String((esResumen as { competencia?: unknown }).competencia ?? "").trim());
      data = tieneResumen || !clip.resumen_ia
        ? clip.editor_state
        : { ...(es as object), resumen: clip.resumen_ia };
    } else {
      const notes = notesByClip.get(clip.id) ?? [];
      data = {
        cliente: c.slug,
        fecha,
        // Resumen inicial = el que generó n8n para el mail (si vino). El botón lo regenera.
        resumen: clip.resumen_ia ?? null,
        articles: notes.map((n) => ({
          seccion: n.seccion ?? "",
          medio: n.medio ?? "",
          fecha: fechaCorta(n.pub_date),
          titulo: n.titulo ?? "",
          url: n.url ?? "",
          snippet: n.snippet ?? "",
        })),
      };
    }
    return { slug: c.slug, nombre: c.nombre, clippingId: clip.id, data, fecha: clip.fecha };
  });

  payloads.sort((a, b) => {
    const ia = ORDEN.indexOf(a.slug), ib = ORDEN.indexOf(b.slug);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  if (payloads.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-6">
        <h1 className="text-xl font-semibold text-slate-800 mb-2">Clippings</h1>
        <p className="text-sm text-slate-400 mt-4">No tenés clientes asignados.</p>
      </div>
    );
  }

  return <PrincipalClient clients={payloads} />;
}
