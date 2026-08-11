import { createClient } from "@/lib/supabase/server";
import { ordenarClientes } from "@/lib/clientes";
import {
  FileText,
  Send,
  PlusCircle,
  Trash2,
  Paintbrush,
  ArrowUpDown,
  Undo2,
  Sparkles,
} from "lucide-react";
import EstadisticasFilter from "./EstadisticasFilter";
import SeccionMediosTabs from "./SeccionMediosTabs";
import { canonSection } from "@/lib/clip/canon";

export const dynamic = "force-dynamic";

function arDate(ts: string): string {
  return new Date(new Date(ts).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function chip(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
}
function relTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}
const ACCION_LABEL: Record<string, string> = {
  agrega: "agregó una nota",
  quita: "eliminó una nota",
  reordena: "reordenó",
  pinta: "pintó texto",
  despinta: "despintó texto",
  exporta: "copió para mail",
  resumen: "generó resumen IA",
  regresa: "deshizo un cambio",
};

type ClipRow = {
  id: string;
  client_id: string;
  fecha: string;
  estado: string;
  clients: { nombre: string } | { nombre: string }[] | null;
};
type ActRow = { accion: string; created_at: string; clipping_id: string };
type NoteRow = { clipping_id: string; seccion: string | null; medio: string | null };

export default async function EstadisticasPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const sp = await searchParams;
  const clientId = sp.cliente && sp.cliente !== "all" ? sp.cliente : null;
  const supabase = await createClient();

  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre").order("nombre");
  // Las dos versiones de cada clipping, la que se envía hoy y la nueva (decisión de Adrián,
  // 11/08). Quién ve qué lo define RLS via user_client_access.
  const clients = ordenarClientes((clientRows ?? []) as { id: string; slug: string; nombre: string }[]);

  let clipQ = supabase.from("clippings").select("id, client_id, fecha, estado, clients(nombre)");
  if (clientId) clipQ = clipQ.eq("client_id", clientId);
  const { data: clipRows } = await clipQ;
  const clips = (clipRows ?? []) as ClipRow[];
  const clipIds = clips.map((c) => c.id);

  const since30 = new Date(Date.now() - 30 * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
  const clip30 = clips.filter((c) => c.fecha >= since30).map((c) => c.id);

  const [actRes, notesRes] = await Promise.all([
    (async () => {
      let aq = supabase
        .from("activity")
        .select("accion, created_at, clipping_id")
        .order("created_at", { ascending: false })
        .limit(300);
      if (clientId) aq = clipIds.length ? aq.in("clipping_id", clipIds) : aq.eq("clipping_id", "00000000-0000-0000-0000-000000000000");
      return aq;
    })(),
    clip30.length
      ? supabase.from("notes").select("clipping_id, seccion, medio").in("clipping_id", clip30).eq("incluida", true)
      : Promise.resolve({ data: [] as NoteRow[] }),
  ]);
  const acts = (actRes.data ?? []) as ActRow[];
  const notes = (notesRes.data ?? []) as NoteRow[];

  const nombreOf = (r: ClipRow) => (Array.isArray(r.clients) ? r.clients[0] : r.clients)?.nombre ?? "—";
  const clipById = new Map(clips.map((c) => [c.id, c]));

  const totalClippings = clips.length;
  const exportados = clips.filter((c) => c.estado === "exportado").length;
  const totalExportEvents = acts.filter((a) => a.accion === "exporta").length;
  const notasEditadas = acts.filter((a) => ["agrega", "quita", "reordena", "pinta"].includes(a.accion)).length;

  // Por cliente (solo si "todos")
  const perClient = new Map<string, { nombre: string; total: number; exportados: number; ultima: string | null }>();
  for (const c of clips) {
    const e = perClient.get(c.client_id) ?? { nombre: nombreOf(c), total: 0, exportados: 0, ultima: null };
    e.total++;
    if (c.estado === "exportado") {
      e.exportados++;
      if (!e.ultima || c.fecha > e.ultima) e.ultima = c.fecha;
    }
    perClient.set(c.client_id, e);
  }
  const clientStats = [...perClient.values()].sort((a, b) => b.total - a.total);

  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const r30 = acts.filter((a) => a.created_at >= since);
  const bd = [
    { label: "Copias a mail", value: r30.filter((a) => a.accion === "exporta").length, Icon: Send },
    { label: "Resúmenes IA", value: r30.filter((a) => a.accion === "resumen").length, Icon: Sparkles },
    { label: "Notas agregadas", value: r30.filter((a) => a.accion === "agrega").length, Icon: PlusCircle },
    { label: "Notas eliminadas", value: r30.filter((a) => a.accion === "quita").length, Icon: Trash2 },
    { label: "Reordenamientos", value: r30.filter((a) => a.accion === "reordena").length, Icon: ArrowUpDown },
    { label: "Pintados", value: r30.filter((a) => a.accion === "pinta" || a.accion === "despinta").length, Icon: Paintbrush },
    { label: "Deshacer", value: r30.filter((a) => a.accion === "regresa").length, Icon: Undo2 },
  ];

  // Exportaciones por día (14)
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 86400000 - 3 * 3600000).toISOString().slice(0, 10));
  const exportsByDay = days.map((d) => ({ d, n: acts.filter((a) => a.accion === "exporta" && arDate(a.created_at) === d).length }));
  const maxDay = Math.max(1, ...exportsByDay.map((x) => x.n));

  // Notas por sección (canónica, como el editor) + top medios — últimos 30 días
  const bySeccion = new Map<string, number>();
  const byMedio = new Map<string, number>();
  for (const n of notes) {
    const clip = clipById.get(n.clipping_id);
    const sec = clip ? canonSection(nombreOf(clip), n.seccion) : "—";
    bySeccion.set(sec, (bySeccion.get(sec) ?? 0) + 1);
    const med = (n.medio || "").trim();
    if (med) byMedio.set(med, (byMedio.get(med) ?? 0) + 1);
  }
  const secciones = [...bySeccion.entries()].sort((a, b) => b[1] - a[1]);
  const topMedios = [...byMedio.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // EXPORTADAS: contenido final de los clippings que se exportaron (editor_state), no lo entregado por n8n.
  const exportedIds = clips.filter((c) => c.estado === "exportado" && clip30.includes(c.id)).map((c) => c.id);
  const { data: expStateRows } = exportedIds.length
    ? await supabase.from("user_clipping_state").select("clipping_id, editor_state").in("clipping_id", exportedIds)
    : { data: [] as { clipping_id: string; editor_state: unknown }[] };
  const stateByClip = new Map<string, unknown>();
  for (const r of (expStateRows ?? []) as { clipping_id: string; editor_state: unknown }[]) {
    if (!stateByClip.has(r.clipping_id)) stateByClip.set(r.clipping_id, r.editor_state);
  }
  const bySeccionExp = new Map<string, number>();
  const byMedioExp = new Map<string, number>();
  for (const [cid, st] of stateByClip) {
    const clip = clipById.get(cid);
    const secs = (st as { sections?: { titulo?: string; notas?: { medio?: string }[] }[] } | null)?.sections ?? [];
    for (const s of secs) {
      const secName = clip ? canonSection(nombreOf(clip), s.titulo ?? "") : s.titulo ?? "—";
      const nn = s.notas ?? [];
      if (nn.length) bySeccionExp.set(secName, (bySeccionExp.get(secName) ?? 0) + nn.length);
      for (const n of nn) {
        const med = (n.medio || "").trim();
        if (med) byMedioExp.set(med, (byMedioExp.get(med) ?? 0) + 1);
      }
    }
  }
  const seccionesExp = [...bySeccionExp.entries()].sort((a, b) => b[1] - a[1]);
  const topMediosExp = [...byMedioExp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const cards = [
    { label: "Clippings", value: totalClippings, Icon: FileText, hint: "cargados en total" },
    { label: "Exportados", value: exportados, Icon: Send, hint: `${totalExportEvents} envíos` },
    { label: "Notas editadas", value: notasEditadas, Icon: PlusCircle, hint: "agregar/quitar/mover/pintar" },
  ];

  const totalExportsWindow = exportsByDay.reduce((s, x) => s + x.n, 0);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Estadísticas</h1>
        <EstadisticasFilter clients={clients} value={clientId ?? "all"} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <c.Icon size={16} />
              <span className="text-xs font-medium uppercase tracking-wide">{c.label}</span>
            </div>
            <p className="text-3xl font-semibold text-foreground mt-2">{c.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground mb-3">Exportaciones · últimos 14 días</h2>
          {totalExportsWindow === 0 ? (
            <p className="h-32 flex items-center justify-center text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <div className="flex items-end gap-1.5 h-32">
              {exportsByDay.map((x) => (
                <div key={x.d} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="w-full flex items-end justify-center h-full">
                    <div
                      className="w-full rounded-t bg-brand group-hover:bg-brand-dark"
                      style={{ height: `${(x.n / maxDay) * 100}%`, minHeight: x.n ? 4 : 0 }}
                      title={`${x.n} exportaciones`}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{chip(x.d).split(" ")[0]}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground mb-3">Actividad · últimos 30 días</h2>
          <div className="grid grid-cols-2 gap-2">
            {bd.map((b) => (
              <div key={b.label} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                <b.Icon size={15} className="text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground/80 flex-1 truncate">{b.label}</span>
                <span className="text-sm font-semibold text-foreground">{b.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tipos de noticias + Top medios (Exportadas / Encontradas) */}
      <SeccionMediosTabs
        exportadas={{ secciones: seccionesExp, topMedios: topMediosExp }}
        encontradas={{ secciones, topMedios }}
      />

      {!clientId && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <h2 className="text-sm font-medium text-foreground px-4 py-3 border-b border-border">Por cliente</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium text-right">Clippings</th>
                  <th className="px-4 py-2 font-medium text-right">Exportados</th>
                  <th className="px-4 py-2 font-medium text-right">Última exportación</th>
                </tr>
              </thead>
              <tbody>
                {clientStats.map((c) => (
                  <tr key={c.nombre} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground/90">{c.nombre}</td>
                    <td className="px-4 py-2.5 text-right text-foreground/80">{c.total}</td>
                    <td className="px-4 py-2.5 text-right text-foreground/80">{c.exportados}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{c.ultima ? chip(c.ultima) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <h2 className="text-sm font-medium text-foreground px-4 py-3 border-b border-border">
          Actividad reciente
        </h2>
        {acts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Sin actividad todavía.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {acts.slice(0, 12).map((a, i) => {
              const clip = clipById.get(a.clipping_id);
              const nombre = clip ? nombreOf(clip) : "—";
              return (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="text-foreground/90">
                    <span className="font-medium">{nombre}</span>{" "}
                    <span className="text-muted-foreground">{ACCION_LABEL[a.accion] ?? a.accion}</span>
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{relTime(a.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
