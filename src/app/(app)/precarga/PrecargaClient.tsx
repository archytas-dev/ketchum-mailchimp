"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Download, RefreshCw, Check, Pencil, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addPrecarga,
  listPrecarga,
  delPrecarga,
  updatePrecarga,
  fetchMeta,
  type PrecargaRow,
} from "./actions";

export type ClientOpt = { id: string; slug: string; nombre: string };

type Draft = { medio: string; titulo: string; url: string; snippet: string; loading?: boolean };
type EditFields = { medio: string; titulo: string; url: string; snippet: string };

// Fecha de mañana en horario AR (UTC-3), formato YYYY-MM-DD.
function tomorrowAR(): string {
  const now = new Date(Date.now() - 3 * 3600 * 1000 + 24 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

const SECCION = "Notas Exclusivas";
const emptyDraft = (): Draft => ({ medio: "", titulo: "", url: "", snippet: "" });

export default function PrecargaClient({ clients }: { clients: ClientOpt[] }) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [fecha, setFecha] = useState<string>(() => tomorrowAR());
  const [rows, setRows] = useState<Draft[]>([emptyDraft()]);
  const [existing, setExisting] = useState<PrecargaRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [bulk, setBulk] = useState("");

  // Edición inline de una precargada + borrado con confirmación.
  const [editId, setEditId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({ medio: "", titulo: "", url: "", snippet: "" });
  const [delTarget, setDelTarget] = useState<PrecargaRow | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId || !fecha) return;
    const res = await listPrecarga(clientId, fecha);
    if (res.ok) setExisting(res.rows ?? []);
  }, [clientId, fecha]);

  useEffect(() => {
    let alive = true;
    listPrecarga(clientId, fecha).then((res) => {
      if (alive && res.ok) setExisting(res.rows ?? []);
    });
    return () => {
      alive = false;
    };
  }, [clientId, fecha]);

  function setRow(i: number, patch: Partial<Draft>) {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function addRow() {
    setRows((r) => [...r, emptyDraft()]);
  }
  function removeRow(i: number) {
    setRows((r) => (r.length === 1 ? [emptyDraft()] : r.filter((_, j) => j !== i)));
  }

  async function autofill(i: number) {
    const url = rows[i].url.trim();
    if (!url) return;
    setRow(i, { loading: true });
    const res = await fetchMeta(url);
    setRow(i, {
      loading: false,
      titulo: res.titulo || rows[i].titulo,
      snippet: res.snippet || rows[i].snippet,
    });
    if (!res.ok) toast.error("No se pudo leer", { description: res.error });
    else if (!res.titulo && !res.snippet) toast.warning("La página no expuso título ni descripción");
  }

  // Pega una lista de URLs (o "medio | url" por línea) y crea filas.
  function importBulk() {
    const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const nuevos: Draft[] = lines.map((l) => {
      const parts = l.split("|").map((p) => p.trim());
      if (parts.length >= 2) return { medio: parts[0], url: parts[1], titulo: "", snippet: "" };
      return { medio: "", url: parts[0], titulo: "", snippet: "" };
    });
    setRows((r) => {
      const base = r.filter((x) => x.url || x.titulo || x.medio);
      return [...base, ...nuevos];
    });
    setBulk("");
    toast.success(`${nuevos.length} fila(s) agregada(s). Usá "Autocompletar todas" para traer título y descripción.`);
  }

  async function autofillAll() {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].url && (!rows[i].titulo || !rows[i].snippet)) {
        await autofill(i);
      }
    }
  }

  async function save() {
    if (!clientId || !fecha) return;
    const notes = rows
      .filter((r) => r.titulo.trim() && r.url.trim())
      .map((r) => ({ medio: r.medio, titulo: r.titulo, url: r.url, snippet: r.snippet, seccion: SECCION }));
    if (!notes.length) {
      toast.error("Nada para guardar", { description: "Cada nota necesita al menos título y URL." });
      return;
    }
    setSaving(true);
    const res = await addPrecarga(clientId, fecha, notes);
    setSaving(false);
    if (!res.ok) {
      toast.error("No se pudo precargar", { description: res.error });
      return;
    }
    toast.success(`${res.count} nota(s) precargada(s)`);
    setRows([emptyDraft()]);
    void refresh();
  }

  function startEdit(e: PrecargaRow) {
    setEditId(e.id);
    setEditFields({ medio: e.medio ?? "", titulo: e.titulo ?? "", url: e.url ?? "", snippet: e.snippet ?? "" });
  }
  function cancelEdit() {
    setEditId(null);
  }
  async function saveEdit(id: string) {
    const res = await updatePrecarga(id, editFields);
    if (!res.ok) {
      toast.error("No se pudo guardar", { description: res.error });
      return;
    }
    toast.success("Nota actualizada");
    setEditId(null);
    void refresh();
  }

  async function confirmDelete() {
    if (!delTarget) return;
    const res = await delPrecarga(delTarget.id);
    setDelTarget(null);
    if (!res.ok) {
      toast.error("No se pudo borrar", { description: res.error });
      return;
    }
    toast.success("Nota eliminada");
    void refresh();
  }

  const clienteNombre = clients.find((c) => c.id === clientId)?.nombre ?? "";
  const pendientes = existing.filter((e) => !e.consumed_at);
  const volcadas = existing.filter((e) => e.consumed_at);

  return (
    <div className="space-y-6">
      {/* Selector de cliente + fecha — arriba y prominente */}
      <div className="flex flex-wrap gap-4 items-end bg-muted/40 border rounded-lg p-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Cliente</span>
          <Select value={clientId} onValueChange={(v) => v && setClientId(v)}>
            <SelectTrigger className="min-w-[240px] h-11 text-base font-semibold bg-background shadow-sm">
              <SelectValue placeholder="Elegí un cliente" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-base">
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Fecha del clipping</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="border rounded-md px-4 py-2.5 bg-background text-base shadow-sm"
          />
        </label>
      </div>

      {/* Ya precargadas — arriba para ver de una lo que hay */}
      <section className="space-y-2">
        <h2 className="font-medium">
          Precargadas de {clienteNombre} para {fecha} · {pendientes.length} pendiente
          {pendientes.length === 1 ? "" : "s"}
        </h2>
        {existing.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada precargado todavía para este cliente y fecha.</p>
        ) : (
          <ul className="space-y-2">
            {pendientes.map((e) =>
              editId === e.id ? (
                <li key={e.id} className="border rounded-md p-3 space-y-2 bg-muted/30">
                  <input
                    value={editFields.medio}
                    onChange={(ev) => setEditFields((f) => ({ ...f, medio: ev.target.value }))}
                    placeholder="Medio"
                    className="border rounded-md px-2 py-1.5 text-sm bg-background w-full"
                  />
                  <input
                    value={editFields.url}
                    onChange={(ev) => setEditFields((f) => ({ ...f, url: ev.target.value }))}
                    placeholder="URL"
                    className="border rounded-md px-2 py-1.5 text-sm bg-background w-full"
                  />
                  <input
                    value={editFields.titulo}
                    onChange={(ev) => setEditFields((f) => ({ ...f, titulo: ev.target.value }))}
                    placeholder="Título"
                    className="border rounded-md px-2 py-1.5 text-sm bg-background w-full"
                  />
                  <textarea
                    value={editFields.snippet}
                    onChange={(ev) => setEditFields((f) => ({ ...f, snippet: ev.target.value }))}
                    placeholder="Descripción"
                    rows={2}
                    className="border rounded-md px-2 py-1.5 text-sm bg-background w-full resize-y"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={cancelEdit}>
                      <X size={14} /> Cancelar
                    </Button>
                    <Button size="sm" onClick={() => saveEdit(e.id)}>
                      <Check size={14} /> Guardar
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={e.id} className="flex items-start gap-2 text-sm border rounded-md px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{e.medio || "—"}</div>
                    <div className="truncate">{e.titulo}</div>
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground truncate block hover:underline">
                        {e.url}
                      </a>
                    ) : null}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => startEdit(e)} title="Editar">
                    <Pencil size={15} />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDelTarget(e)} title="Eliminar">
                    <Trash2 size={15} />
                  </Button>
                </li>
              ),
            )}
            {volcadas.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 text-sm border rounded-md px-3 py-2 opacity-60"
                title="Ya volcada al clipping (no editable)"
              >
                <Check size={15} className="text-green-600 shrink-0" />
                <span className="font-medium min-w-[140px] truncate">{e.medio || "—"}</span>
                <span className="flex-1 truncate">{e.titulo}</span>
                <span className="text-xs text-muted-foreground">volcada</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cargar nuevas */}
      <section className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Agregar notas</h2>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={autofillAll}>
              <RefreshCw size={14} /> Autocompletar todas
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus size={14} /> Fila
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2 items-start border-b pb-3">
              <input
                placeholder="Medio"
                value={r.medio}
                onChange={(e) => setRow(i, { medio: e.target.value })}
                className="border rounded-md px-2 py-1.5 text-sm bg-background"
              />
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    placeholder="URL"
                    value={r.url}
                    onChange={(e) => setRow(i, { url: e.target.value })}
                    className="border rounded-md px-2 py-1.5 text-sm bg-background flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={r.loading}
                    onClick={() => autofill(i)}
                    title="Traer título y descripción"
                  >
                    <Download size={14} /> {r.loading ? "..." : "Traer"}
                  </Button>
                </div>
                <input
                  placeholder="Título"
                  value={r.titulo}
                  onChange={(e) => setRow(i, { titulo: e.target.value })}
                  className="border rounded-md px-2 py-1.5 text-sm bg-background"
                />
                <textarea
                  placeholder="Descripción"
                  value={r.snippet}
                  onChange={(e) => setRow(i, { snippet: e.target.value })}
                  rows={2}
                  className="border rounded-md px-2 py-1.5 text-sm bg-background resize-y"
                />
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} title="Quitar fila">
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Pegar lista de URLs</summary>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              Una por línea. Formato <code>medio | url</code> o solo <code>url</code>. Después usá
              &quot;Autocompletar todas&quot;.
            </p>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={4}
              className="border rounded-md px-2 py-1.5 text-sm bg-background w-full"
              placeholder={"La Voz | https://...\nhttps://..."}
            />
            <Button type="button" variant="outline" size="sm" onClick={importBulk}>
              <Plus size={14} /> Agregar filas
            </Button>
          </div>
        </details>

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={saving}>
            <Check size={16} /> {saving ? "Guardando..." : "Precargar"}
          </Button>
        </div>
      </section>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar nota precargada</AlertDialogTitle>
            <AlertDialogDescription>
              {delTarget ? `"${delTarget.titulo}" (${delTarget.medio || "sin medio"}). Esta acción no se puede deshacer.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDelTarget(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
