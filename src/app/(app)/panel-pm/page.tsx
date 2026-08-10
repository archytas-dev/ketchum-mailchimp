import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import {
  flattenEditorState,
  computeDiff,
  computeStats,
  normalizeUrlForDiff,
  type BaseNote,
} from "@/lib/pm-diff";
import PanelPmFilter from "./PanelPmFilter";
import { ClipboardList, TrendingUp, AlertOctagon, Cpu, Undo2, PlusCircle, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

const ORDEN = ["booking", "bms", "msd", "mars"];

const TIPO_LABEL: Record<string, string> = {
  rojo: "Eliminada",
  verde: "Agregada — nueva",
  amarillo_nueva: "Agregada — ya la teníamos",
  amarillo_editada: "Editada",
};

const MOTIVO_LABEL: Record<string, string> = {
  no_aprobado_por_ia: "la IA no la aprobó",
  filtro_deterministico_quality_guard: "filtro de calidad post-IA",
};

const FASE_LABEL: Record<string, string> = { ai_filter: "Filtro IA", post_ai: "Post-IA" };

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
  const clients = ((clientRows ?? []) as { id: string; slug: string; nombre: string }[]).sort((a, b) => {
    const ia = ORDEN.indexOf(a.slug);
    const ib = ORDEN.indexOf(b.slug);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

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

  const rojas = rows.filter((r) => r.tipo === "rojo");
  const verdes = rows.filter((r) => r.tipo === "verde");
  const amarillas = rows.filter((r) => r.tipo === "amarillo_nueva" || r.tipo === "amarillo_editada");

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
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-center">
                <p className="text-xs text-red-700">Eliminadas</p>
                <p className="text-lg font-semibold text-red-700">{rojas.length}</p>
              </div>
              <div className="rounded-lg bg-green-50 border border-green-200 p-2 text-center">
                <p className="text-xs text-green-700">Nuevas (cobertura)</p>
                <p className="text-lg font-semibold text-green-700">{verdes.length}</p>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-center">
                <p className="text-xs text-amber-700">Recuperadas + editadas</p>
                <p className="text-lg font-semibold text-amber-700">{amarillas.length}</p>
              </div>
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Precisión / Cobertura</p>
                <p className="text-lg font-semibold text-foreground">
                  {pct(stats.precision)} / {pct(stats.cobertura)}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Precisión = qué % de lo que mandamos sirvió. Cobertura = qué % del clipping final
              salió de nosotros. Rojo = ruido que mandamos, verde = hueco de cobertura (revisar
              el medio), amarillo-nueva = filtro mal calibrado (ver fase y motivo abajo).
            </p>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin diferencias — el cliente no tocó nada.</p>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((r) => {
                  const d = r.descartada;
                  const titulo = r.final?.titulo || r.base?.titulo || r.urlNorm;
                  const medio = r.final?.medio || r.base?.medio;
                  const Icon =
                    r.tipo === "rojo"
                      ? Undo2
                      : r.tipo === "amarillo_editada"
                        ? Pencil
                        : PlusCircle;
                  const color =
                    r.tipo === "rojo"
                      ? "text-red-600"
                      : r.tipo === "verde"
                        ? "text-green-600"
                        : "text-amber-600";
                  return (
                    <li key={r.urlNorm} className="flex items-start gap-2 text-sm">
                      <Icon size={14} className={color + " shrink-0 mt-0.5"} />
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground/90 truncate">{titulo}</p>
                        <p className="text-xs text-muted-foreground">
                          {medio ?? "medio desconocido"} · {TIPO_LABEL[r.tipo]}
                          {d ? ` · ${FASE_LABEL[d.fase] ?? d.fase}: ${MOTIVO_LABEL[d.motivo] ?? d.motivo}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
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
