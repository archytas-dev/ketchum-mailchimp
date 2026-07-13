"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportClipping } from "./actions";
import { renderClipping, hasRenderer, type Article } from "@/lib/render";

export type Note = {
  id: string;
  seccion: string | null;
  medio: string | null;
  titulo: string;
  snippet: string | null;
  url: string | null;
  pub_date: string | null;
  orden: number;
  incluida: boolean;
  origen: string;
  pintada: boolean;
};

function notesToArticles(notes: Note[]): Article[] {
  return notes
    .filter((n) => n.incluida)
    .sort((a, b) => a.orden - b.orden)
    .map((n) => ({
      id: n.id,
      title: n.titulo,
      snippet: n.snippet ?? "",
      medio: n.medio ?? "",
      grupo: n.seccion ?? "",
      url: n.url ?? "",
      pubDate: n.pub_date ?? "",
    }));
}

export default function Editor({
  clippingId,
  slug,
  initial,
  isPast,
  exportHtml,
}: {
  clippingId: string;
  slug: string;
  initial: Note[];
  isPast: boolean;
  exportHtml: string | null;
}) {
  const supabase = createClient();
  const [notes, setNotes] = useState<Note[]>(initial);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Note[][]>([]);
  const ref = useRef<HTMLDivElement>(null);
  // Handlers vivos para los controles imperativos.
  const handlers = useRef<{
    remove: (id: string) => void;
    move: (id: string, dir: -1 | 1) => void;
    paint: (id: string) => void;
  }>({ remove: () => {}, move: () => {}, paint: () => {} });

  const canRender = hasRenderer(slug);

  const previewHtml = useMemo(() => {
    if (isPast) return exportHtml ?? "";
    if (!canRender) return "";
    return (
      renderClipping(slug, { articles: notesToArticles(notes), resumen: {} }) ??
      ""
    );
  }, [notes, slug, isPast, exportHtml, canRender]);

  async function currentUserId() {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  }

  async function removeNote(id: string) {
    if (isPast) return;
    setHistory((h) => [...h, notes]);
    setNotes((ns) => ns.map((x) => (x.id === id ? { ...x, incluida: false } : x)));
    await supabase.from("notes").update({ incluida: false }).eq("id", id);
    await supabase.from("activity").insert({
      clipping_id: clippingId,
      user_id: await currentUserId(),
      accion: "quita",
      note_id: id,
    });
  }

  async function moveNote(id: string, dir: -1 | 1) {
    if (isPast) return;
    const cur = notes.find((n) => n.id === id);
    if (!cur) return;
    // Vecinos incluidos de la MISMA sección (el render agrupa por sección).
    const mates = notes
      .filter((n) => n.incluida && (n.seccion ?? "") === (cur.seccion ?? ""))
      .sort((a, b) => a.orden - b.orden);
    const i = mates.findIndex((n) => n.id === id);
    const j = i + dir;
    if (j < 0 || j >= mates.length) return;
    const other = mates[j];
    setHistory((h) => [...h, notes]);
    setNotes((ns) =>
      ns.map((n) => {
        if (n.id === cur.id) return { ...n, orden: other.orden };
        if (n.id === other.id) return { ...n, orden: cur.orden };
        return n;
      }),
    );
    await supabase.from("notes").update({ orden: other.orden }).eq("id", cur.id);
    await supabase.from("notes").update({ orden: cur.orden }).eq("id", other.id);
    await supabase.from("activity").insert({
      clipping_id: clippingId,
      user_id: await currentUserId(),
      accion: "reordena",
      note_id: id,
    });
  }

  async function togglePaint(id: string) {
    if (isPast) return;
    const cur = notes.find((n) => n.id === id);
    if (!cur) return;
    const next = !cur.pintada;
    setNotes((ns) => ns.map((x) => (x.id === id ? { ...x, pintada: next } : x)));
    await supabase.from("notes").update({ pintada: next }).eq("id", id);
    await supabase.from("activity").insert({
      clipping_id: clippingId,
      user_id: await currentUserId(),
      accion: next ? "pinta" : "despinta",
      note_id: id,
    });
  }

  async function undo() {
    if (isPast || history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    const changed = prev.filter((p) => {
      const c = notes.find((x) => x.id === p.id);
      return c && (c.incluida !== p.incluida || c.orden !== p.orden);
    });
    setNotes(prev);
    for (const p of changed) {
      await supabase
        .from("notes")
        .update({ incluida: p.incluida, orden: p.orden })
        .eq("id", p.id);
    }
    await supabase.from("activity").insert({
      clipping_id: clippingId,
      user_id: await currentUserId(),
      accion: "regresa",
    });
  }

  handlers.current.remove = removeNote;
  handlers.current.move = moveNote;
  handlers.current.paint = togglePaint;

  // Set de ids pintados para reflejarlo en el render.
  const painted = useMemo(
    () => new Set(notes.filter((n) => n.pintada).map((n) => n.id)),
    [notes],
  );

  // Inyecta controles (eliminar / mover) sobre cada nota del clipping renderizado.
  useEffect(() => {
    if (isPast || !ref.current) return;
    const root = ref.current;
    const blocks = root.querySelectorAll<HTMLElement>("[data-note-id]");
    blocks.forEach((el) => {
      const id = el.getAttribute("data-note-id");
      if (!id) return;
      el.style.position = "relative";
      el.style.transition = "opacity .18s ease, transform .18s ease";
      el.classList.add("kx-note");
      // Idempotente: si React re-renderizó el HTML y borró la barra, re-inyecta;
      // si ya está, no dupliques.
      if (el.querySelector(":scope > .kx-ctrl")) return;

      const bar = document.createElement("div");
      bar.className = "kx-ctrl";
      bar.innerHTML =
        '<button data-act="up" title="Subir">↑</button>' +
        '<button data-act="down" title="Bajar">↓</button>' +
        '<button data-act="paint" title="Pintar / Despintar">🖌</button>' +
        '<button data-act="del" title="Eliminar">✕</button>';
      bar.querySelectorAll("button").forEach((b) => {
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const act = (b as HTMLElement).getAttribute("data-act");
          if (act === "del") {
            el.style.opacity = "0";
            el.style.transform = "translateX(8px)";
            setTimeout(() => handlers.current.remove(id), 170);
          } else if (act === "up") {
            handlers.current.move(id, -1);
          } else if (act === "down") {
            handlers.current.move(id, 1);
          } else if (act === "paint") {
            handlers.current.paint(id);
          }
        });
      });
      el.appendChild(bar);
    });
  }, [previewHtml, notes, isPast]);

  // Refleja el estado "pintada" sobre las notas renderizadas.
  useEffect(() => {
    if (!ref.current) return;
    ref.current
      .querySelectorAll<HTMLElement>("[data-note-id]")
      .forEach((el) => {
        const id = el.getAttribute("data-note-id");
        el.classList.toggle("kx-painted", !!id && painted.has(id));
      });
  }, [painted, previewHtml]);

  async function copiarParaMail() {
    setBusy(true);
    setError(null);
    const res = await exportClipping(clippingId);
    const html = res.ok && res.html ? res.html : previewHtml;
    if (!res.ok && !html) {
      setError(res.error || "Error al exportar");
      setBusy(false);
      return;
    }
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("No se pudo copiar al portapapeles");
    }
    setBusy(false);
  }

  const included = notes.filter((n) => n.incluida).length;

  return (
    <div className="space-y-4">
      <style>{`
        .kx-note .kx-ctrl {
          position:absolute; top:6px; right:6px; display:flex; gap:4px;
          opacity:0; transition:opacity .15s ease; z-index:5;
        }
        .kx-note:hover .kx-ctrl { opacity:1; }
        .kx-ctrl button {
          width:24px; height:24px; border:none; border-radius:6px; cursor:pointer;
          background:#243f55; color:#fff; font-size:13px; line-height:1;
          box-shadow:0 1px 3px rgba(0,0,0,.2); display:flex; align-items:center; justify-content:center;
        }
        .kx-ctrl button:hover { background:#1b3143; }
        .kx-painted {
          background:#fff7cc !important;
          box-shadow:inset 3px 0 0 #f5b301, 0 0 0 1px #f5d24e;
          border-radius:6px;
        }
      `}</style>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {isPast
            ? "Vista de lo enviado (solo lectura)"
            : `${included} notas · pasá el mouse sobre una para mover o eliminar`}
        </p>
        <div className="flex items-center gap-2">
          {!isPast && (
            <button
              onClick={undo}
              disabled={history.length === 0}
              title="Regresar el último cambio"
              className="text-sm rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-100 disabled:opacity-40"
            >
              ↶ Regresar
            </button>
          )}
          <button
            onClick={copiarParaMail}
            disabled={busy}
            className="rounded-lg bg-[#243f55] text-white text-sm font-medium px-4 py-2 hover:bg-[#1b3143] disabled:opacity-50"
          >
            {busy ? "Generando…" : copied ? "Copiado ✓" : "Copiar para Mail"}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {previewHtml ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div ref={ref} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
          {isPast
            ? "No hay HTML exportado guardado para este día."
            : `Render pendiente para "${slug}".`}
        </div>
      )}
    </div>
  );
}
