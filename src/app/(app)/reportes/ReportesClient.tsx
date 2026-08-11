"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCachedList } from "@/lib/use-cached-list";
import { listReportes, addReporte, updateReporteEstado } from "./actions";
import { TIPOS_REPORTE, type ReporteRow } from "./tipos";

export type ClientOpt = { id: string; slug: string; nombre: string };

const ESTADO_LABEL: Record<ReporteRow["estado"], string> = {
  abierto: "Abierto",
  en_revision: "En revisión",
  resuelto: "Resuelto",
  descartado: "Descartado",
};

const ESTADO_CLASES: Record<ReporteRow["estado"], string> = {
  abierto: "border-amber-200 bg-amber-50 text-amber-700",
  en_revision: "border-blue-200 bg-blue-50 text-blue-700",
  resuelto: "border-green-200 bg-green-50 text-green-700",
  descartado: "border-border bg-muted text-muted-foreground",
};

function tipoLabel(tipo: string | null): string {
  return TIPOS_REPORTE.find((t) => t.value === tipo)?.label ?? tipo ?? "—";
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export default function ReportesClient({
  clients,
  isStaff,
}: {
  clients: ClientOpt[];
  isStaff: boolean;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const { rows, setRows, loading, refresh } = useCachedList<ReporteRow>(`reportes:${clientId}`, () =>
    listReportes(clientId),
  );

  // Por defecto, el clipping de hoy: es de lejos el caso mas comun (se revisa el mail del dia).
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(hoy);
  const [tipo, setTipo] = useState<string>("");
  const [descripcion, setDescripcion] = useState("");
  const [notaUrl, setNotaUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    const res = await addReporte(clientId, { fecha, tipo, descripcion, nota_url: notaUrl });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Reporte enviado — lo vemos y te contamos.");
    setTipo("");
    setDescripcion("");
    setNotaUrl("");
    setFecha(hoy);
    refresh();
  }

  async function handleEstado(row: ReporteRow, estado: ReporteRow["estado"]) {
    const res = await updateReporteEstado(row.id, estado);
    if (!res.ok) return toast.error(res.error);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, estado } : r)));
  }

  if (!clients.length) {
    return <p className="text-sm text-muted-foreground">No hay clientes visibles para tu usuario.</p>;
  }

  const puedeEnviar = !saving && !!tipo && !!descripcion.trim() && !!fecha;

  return (
    <div className="space-y-6">
      {/* Reportar error nuevo */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-foreground mb-1">Reportar error nuevo</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Contanos qué salió mal en un clipping y lo revisamos. Si es sobre una nota puntual,
          pegá el link.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Cliente</label>
            <Select value={clientId} onValueChange={(v) => v && setClientId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elegí un cliente">
                  {(value: string) => clients.find((c) => c.id === value)?.nombre ?? ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="reporte-fecha">
              Fecha del clipping
            </label>
            <Input
              id="reporte-fecha"
              type="date"
              value={fecha}
              max={hoy}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Tipo de error</label>
            <Select value={tipo} onValueChange={(v) => v && setTipo(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elegí el tipo">
                  {(value: string) => tipoLabel(value)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TIPOS_REPORTE.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="reporte-url">
              Link de la nota <span className="font-normal">(opcional)</span>
            </label>
            <Input
              id="reporte-url"
              value={notaUrl}
              onChange={(e) => setNotaUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>

        <div className="space-y-1 mt-3">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="reporte-desc">
            Descripción
          </label>
          <textarea
            id="reporte-desc"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            placeholder="ej. Faltó la nota de Clarín sobre el lanzamiento, salió publicada a las 9."
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        <div className="flex justify-end mt-3">
          <Button onClick={handleSubmit} disabled={!puedeEnviar}>
            <Send className="size-4" /> {saving ? "Enviando…" : "Enviar reporte"}
          </Button>
        </div>
      </div>

      {/* Historial de errores */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-foreground mb-1">Historial de errores</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Todo lo reportado para este cliente, de lo más nuevo a lo más viejo.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no se reportó ningún error.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {fechaCorta(r.fecha ?? r.created_at)}
                  </TableCell>
                  <TableCell className="font-medium">{tipoLabel(r.tipo)}</TableCell>
                  <TableCell className="max-w-md">
                    <p className="text-foreground/90">{r.descripcion}</p>
                    {r.nota_url && (
                      <a
                        href={r.nota_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Ver la nota <ExternalLink className="size-3" />
                      </a>
                    )}
                    {r.resolucion && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium">Resolución:</span> {r.resolucion}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {isStaff ? (
                      <Select
                        value={r.estado}
                        onValueChange={(v) => v && handleEstado(r, v as ReporteRow["estado"])}
                      >
                        <SelectTrigger className="h-8 w-36">
                          <SelectValue>
                            {(value: string) => ESTADO_LABEL[value as ReporteRow["estado"]] ?? value}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(ESTADO_LABEL).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span
                        className={
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium " +
                          ESTADO_CLASES[r.estado]
                        }
                      >
                        {ESTADO_LABEL[r.estado]}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
