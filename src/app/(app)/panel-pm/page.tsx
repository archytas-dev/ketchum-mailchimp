import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import { ordenarClientesActivos } from "@/lib/clientes";
import {
  flattenEditorState,
  computeDiff,
  computeStats,
  normalizeUrlForDiff,
  type BaseNote,
} from "@/lib/pm-diff";
import PanelPmFilter from "./PanelPmFilter";
import DiffList from "./DiffList";
import { ClipboardList, TrendingUp, AlertOctagon, Cpu, PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

export default async function PanelPmPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; clipping?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  // TDD §9: Panel PM es ❌ para cliente, a diferencia de Actividad/Base de Datos donde el
  // cliente ve una versión curada -- acá no hay versión curada, se redirige toda la página.
  const { effective } = await getEffectiveRole(supabase);
  if (!isStaffRole(effective)) redirect("/hoy");

  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  // [19/08] Cutover: solo la herramienta real (-test) -- las tablas que usa esta pantalla
  // (notas_descartadas, reportes, run_stats) ya viven solo bajo el client_id -test.
  const clients = ordenarClientesActivos((clientRows ?? []) as { id: string; slug: string; nombre: string }[]);

  const clientId = sp.cliente && clients.some((c) => c.id === sp.cliente) ? sp.cliente : clients[0]?.id;

  if (!clientId) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-1">Panel PM</h1>
        <p className="text-sm text-muted-foreground">No hay clientes disponibles.</p>
      </div>
    );
  }

  const { data: clippingRows } = await supabase
    .from("clippings")
    .select("id, fecha")
    .eq("client_id", clientId)
    .order("fecha", { ascending: false })
    .limit(30);
  const clippings = (clippingRows ?? []) as { id: string; fecha: string }[];
  const clippingId =
    sp.clipping && clippings.some((c) => c.id === sp.clipping) ? sp.clipping : clippings[0]?.id ?? null;
  const clipping = clippings.find((c) => c.id === clippingId) ?? null;

  if (!clippingId || !clipping) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-foreground">Panel PM</h1>
          <PanelPmFilter clients={clients} clientId={clientId} clippings={clippings} clippingId={null} />
        </div>
        <p className="text-sm text-muted-foreground">Todavía no hay clippings para este cliente.</p>
      </div>
    );
  }

  const [
    { data: baseNotesData },
    { data: finalStateData },
    { data: descartadasData },
    { count: reportesAbiertosCount },
    { data: runStatsData },
    { data: activityData },
  ] = await Promise.all([
    supabase
      .from("notes")
      .select("id, url, titulo, medio, seccion, snippet")
      .eq("clipping_id", clippingId)
      .eq("origen", "n8n")
      .eq("incluida", true),
    supabase.rpc("get_pm_final_state", { p_clipping_id: clippingId }),
    supabase
      .from("notas_descartadas")
      .select("titulo, url, fase, motivo")
      .eq("client_id", clientId)
      .eq("fecha", clipping.fecha),
    supabase
      .from("reportes")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("estado", "abierto"),
    supabase
      .from("run_stats")
      .select("costo_openai_usd, notas_enviadas")
      .eq("client_id", clientId)
      .eq("fecha", clipping.fecha)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("activity").select("accion").eq("clipping_id", clippingId),
  ]);

  const base = (baseNotesData ?? []) as BaseNote[];
  const finalNotes = finalStateData ? flattenEditorState(finalStateData) : null;

  const descartadasPorUrl = new Map<string, { fase: string; motivo: string }>();
  for (const d of (descartadasData ?? []) as { titulo: string; url: string | null; fase: string; motivo: string }[]) {
    const u = normalizeUrlForDiff(d.url);
    if (u) descartadasPorUrl.set(u, { fase: d.fase, motivo: d.motivo });
  }

  const rows = computeDiff(base, finalNotes, descartadasPorUrl);
  const stats = computeStats(base, finalNotes, rows);

  const { count: agregadasManoCount } = await supabase
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("clipping_id", clippingId)
    .eq("origen", "cliente");

  const actividadPorAccion = new Map<string, number>();
  for (const a of (activityData ?? []) as { accion: string }[]) {
    actividadPorAccion.set(a.accion, (actividadPorAccion.get(a.accion) ?? 0) + 1);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Panel PM</h1>
          <p className="text-sm text-muted-foreground">Qué hizo el cliente con lo que le enviamos.</p>
        </div>
        <PanelPmFilter clients={clients} clientId={clientId} clippings={clippings} clippingId={clippingId} />
      </div>

      {/* Métricas (TDD §8.2, tabla de arriba) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp size={12} /> Enviadas / Final
          </p>
          <p className="text-xl font-semibold text-foreground">
            {stats.enviadas} / {stats.totalFinal}
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <PlusCircle size={12} /> Agregadas a mano (DB)
          </p>
          <p className="text-xl font-semibold text-foreground">{agregadasManoCount ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertOctagon size={12} /> Reportes abiertos
          </p>
          <p className="text-xl font-semibold text-foreground">{reportesAbiertosCount ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Cpu size={12} /> Costo IA del día
          </p>
          <p className="text-xl font-semibold text-foreground">
            {runStatsData?.costo_openai_usd != null ? `$${runStatsData.costo_openai_usd.toFixed(4)}` : "—"}
          </p>
        </div>
      </div>

      {/* Diff principal (TDD §8.2, "Vista principal") */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
          <ClipboardList size={15} className="text-muted-foreground" /> Diff del clipping
        </h2>
        {finalNotes === null ? (
          <p className="text-sm text-muted-foreground">
            El cliente todavía no guardó ningún estado de edición para este día — no hay nada
            para comparar todavía.
          </p>
        ) : (
          <DiffList rows={rows} precision={pct(stats.precision)} cobertura={pct(stats.cobertura)} />
        )}
      </div>

      {/* Actividad del día (TDD §8.2, "Actividad por día") */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-foreground mb-3">Actividad sobre este clipping</h2>
        {actividadPorAccion.size === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividad registrada este día.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {[...actividadPorAccion.entries()].map(([accion, n]) => (
              <li key={accion} className="rounded-full bg-muted px-3 py-1 text-xs text-foreground/90">
                {accion} · {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
