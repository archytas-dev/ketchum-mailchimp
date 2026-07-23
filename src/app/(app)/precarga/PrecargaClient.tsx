"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Download, RefreshCw, Check } from "lucide-react";
import {
  addPrecarga,
  listPrecarga,
  delPrecarga,
  fetchMeta,
  type PrecargaRow,
} from "./actions";

export type ClientOpt = { id: string; slug: string; nombre: string };

type Draft = { medio: string; titulo: string; url: string; snippet: string; loading?: boolean };

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
    toast.success(`${nuevos.length} fila(s) agregada(s). Usá "Autocompletar" para traer título y descripción.`);
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

  async function borrar(id: string) {
    const res = await delPrecarga(id);
    if (!res.ok) {
      toast.error("No se pudo borrar", { description: res.error });
      return;
    }
    void refresh();
  }

  const pendientes = existing.filter((e) => !e.consumed_at);
  const volcadas = existing.filter((e) => e.consumed_at);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Cliente</span>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="border rounded-md px-3 py-2 bg-background min-w-[180px]"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Fecha del clipping</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="border rounded-md px-3 py-2 bg-background"
          />
        </label>
      </div>

      <section className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Notas a precargar</h2>
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

      <section className="space-y-2">
        <h2 className="font-medium">
          Ya precargadas para {fecha} ({pendientes.length} pendiente{pendientes.length === 1 ? "" : "s"})
        </h2>
        {existing.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada precargado todavía.</p>
        ) : (
          <ul className="space-y-1">
            {pendientes.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
                <span className="font-medium min-w-[140px] truncate">{e.medio || "—"}</span>
                <span className="flex-1 truncate">{e.titulo}</span>
                <Button variant="ghost" size="icon" onClick={() => borrar(e.id)} title="Quitar">
                  <Trash2 size={15} />
                </Button>
              </li>
            ))}
            {volcadas.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 text-sm border rounded-md px-3 py-2 opacity-60"
                title="Ya volcada al clipping"
              >
                <Check size={15} className="text-green-600" />
                <span className="font-medium min-w-[140px] truncate">{e.medio || "—"}</span>
                <span className="flex-1 truncate">{e.titulo}</span>
                <span className="text-xs text-muted-foreground">volcada</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
