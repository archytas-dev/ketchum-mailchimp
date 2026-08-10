"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { FileText, CalendarDays, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { fetchHistory, fetchExport, type HistRow } from "./actions";

export type ClientTab = { id: string; slug: string; nombre: string };

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaBonita(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[m - 1]} ${y}`;
}

const PAGE = 40;

export default function HistorialView({
  clients,
  initialRows,
  initialHasMore,
}: {
  clients: ClientTab[];
  initialRows: HistRow[];
  initialHasMore: boolean;
}) {
  const [rows, setRows] = useState<HistRow[]>(initialRows);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cliente, setCliente] = useState<string>("all");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pending, startTransition] = useTransition();
  const [loadingMore, setLoadingMore] = useState(false);

  const [selected, setSelected] = useState<HistRow | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [notas, setNotas] = useState(0);
  const [exported, setExported] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  // Cache del contenido ya cargado por día (evita re-fetch al reabrir el mismo clipping).
  const cache = useRef(
    new Map<string, { html: string | null; notas: number; exported: boolean }>(),
  );
  const lastReq = useRef<string | null>(null); // último día pedido (para descartar respuestas viejas)
  // Cache de la lista por combinación de filtros (evita recargar al volver a un cliente ya visto).
  const listCache = useRef(
    new Map<string, { rows: HistRow[]; hasMore: boolean }>([
      ["all||", { rows: initialRows, hasMore: initialHasMore }], // vista inicial ("Todos")
    ]),
  );
  const listReq = useRef<string>("");
  const keyOf = (c: string, d: string, h: string) => `${c}|${d}|${h}`;

  const filters = useMemo(
    () => ({
      clientId: cliente === "all" ? undefined : cliente,
      desde: desde || undefined,
      hasta: hasta || undefined,
    }),
    [cliente, desde, hasta],
  );

  function applyFilters(next: Partial<{ cliente: string; desde: string; hasta: string }>) {
    const c = next.cliente ?? cliente;
    const d = next.desde ?? desde;
    const h = next.hasta ?? hasta;
    const key = keyOf(c, d, h);
    listReq.current = key;
    // Hit de cache: cambio de filtro instantáneo, sin spinner ni re-fetch.
    const hit = listCache.current.get(key);
    if (hit) {
      setRows(hit.rows);
      setHasMore(hit.hasMore);
      return;
    }
    startTransition(async () => {
      const res = await fetchHistory({
        clientId: c === "all" ? undefined : c,
        desde: d || undefined,
        hasta: h || undefined,
        limit: PAGE,
        offset: 0,
      });
      listCache.current.set(key, { rows: res.rows, hasMore: res.hasMore });
      if (listReq.current !== key) return; // el usuario ya cambió de filtro
      setRows(res.rows);
      setHasMore(res.hasMore);
    });
  }

  async function loadMore() {
    setLoadingMore(true);
    const res = await fetchHistory({ ...filters, limit: PAGE, offset: rows.length });
    const merged = [...rows, ...res.rows];
    setRows(merged);
    setHasMore(res.hasMore);
    listCache.current.set(keyOf(cliente, desde, hasta), { rows: merged, hasMore: res.hasMore });
    setLoadingMore(false);
  }

  async function open(row: HistRow) {
    setSelected(row);
    lastReq.current = row.id;
    // Hit de cache: mostrar al instante, sin spinner ni re-fetch.
    const hit = cache.current.get(row.id);
    if (hit) {
      setHtml(hit.html);
      setNotas(hit.notas);
      setExported(hit.exported);
      setViewerLoading(false);
      return;
    }
    setViewerLoading(true);
    setHtml(null);
    const res = await fetchExport(row.id);
    cache.current.set(row.id, { html: res.html, notas: res.notas, exported: res.exported });
    // Descartar si el usuario ya pidió otro día mientras cargaba.
    if (lastReq.current !== row.id) return;
    setHtml(res.html);
    setNotas(res.notas);
    setExported(res.exported);
    setViewerLoading(false);
  }

  const grupos = useMemo(() => {
    const map = new Map<string, HistRow[]>();
    for (const r of rows) {
      const arr = map.get(r.fecha) ?? [];
      arr.push(r);
      map.set(r.fecha, arr);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="px-4 sm:px-6 py-6 h-screen flex flex-col">
      <h1 className="text-xl font-semibold text-foreground mb-4 shrink-0">Historial</h1>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr] flex-1 min-h-0">
        {/* Panel izquierdo: filtros + lista */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex flex-wrap items-end gap-2 bg-card rounded-xl border border-border p-3 shrink-0">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Cliente</label>
              <Select
                value={cliente}
                onValueChange={(v) => {
                  const nv = v ?? "all";
                  setCliente(nv);
                  applyFilters({ cliente: nv });
                }}
              >
                <SelectTrigger className="w-40">
                  <span>
                    {cliente === "all"
                      ? "Todos"
                      : clients.find((c) => c.id === cliente)?.nombre ?? "Cliente"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los clientes</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Desde</label>
              <input
                type="date"
                value={desde}
                onChange={(e) => {
                  setDesde(e.target.value);
                  applyFilters({ desde: e.target.value });
                }}
                className="rounded-lg border border-input px-2 py-1.5 text-sm text-foreground"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Hasta</label>
              <input
                type="date"
                value={hasta}
                onChange={(e) => {
                  setHasta(e.target.value);
                  applyFilters({ hasta: e.target.value });
                }}
                className="rounded-lg border border-input px-2 py-1.5 text-sm text-foreground"
              />
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-y-auto flex-1 min-h-0">
            {pending && (
              <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 size={15} className="animate-spin" /> Cargando…
              </div>
            )}
            {!pending && grupos.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">Sin clippings para esos filtros.</p>
            )}
            {!pending &&
              grupos.map(([fecha, items]) => (
                <div key={fecha}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-muted border-y border-border text-muted-foreground">
                    <CalendarDays size={13} />
                    <span className="text-xs font-medium">{fechaBonita(fecha)}</span>
                  </div>
                  {items.map((r) => {
                    const on = selected?.id === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => open(r)}
                        className={
                          "w-full flex items-center gap-2 px-3 py-2.5 text-left border-b border-border/60 transition " +
                          (on ? "bg-brand/8" : "hover:bg-muted")
                        }
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                          <FileText size={14} />
                        </span>
                        <span className="text-sm text-foreground/90 flex-1 truncate">{r.nombre}</span>
                        <span
                          className={
                            "text-[10px] px-1.5 py-0.5 rounded-full " +
                            (r.exportada
                              ? "bg-green-100 text-green-700"
                              : "bg-muted text-muted-foreground")
                          }
                        >
                          {r.exportada ? "Exportado" : "Sin exportar"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            {!pending && hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-2.5 text-sm text-brand hover:bg-muted disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                Cargar más
              </button>
            )}
          </div>
        </div>

        {/* Panel derecho: visor inline (lo que se copió al mail) */}
        <div className="min-w-0">
          {!selected ? (
            <div className="h-64 lg:h-full rounded-xl border border-dashed border-border bg-card flex items-center justify-center text-sm text-muted-foreground">
              Elegí un día para ver el clipping.
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted sticky top-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{selected.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    {fechaBonita(selected.fecha)}
                    {html ? ` · ${notas} notas` : ""}
                  </p>
                </div>
                {!viewerLoading && html && (
                  <span
                    className={
                      "text-[10px] px-2 py-0.5 rounded-full font-medium " +
                      (exported
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700")
                    }
                  >
                    {exported ? "Exportado" : "Base (sin exportar)"}
                  </span>
                )}
              </div>
              <div className="max-h-[70vh] overflow-auto">
                {viewerLoading ? (
                  <div className="p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Cargando…
                  </div>
                ) : html ? (
                  <div dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    Este día no tiene notas guardadas.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
