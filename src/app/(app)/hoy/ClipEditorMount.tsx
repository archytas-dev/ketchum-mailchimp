"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { mountEditor } from "@/lib/clip/editor.js";
import { saveEditorState, exportClip, generateResumen } from "./actions";
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

export default function ClipEditorMount({
  slug,
  nombre,
  clippingId,
  data,
}: {
  slug: string;
  nombre: string;
  clippingId: string;
  data: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Bridge de confirmación: el editor imperativo pide confirmar → mostramos AlertDialog de shadcn.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState("");
  const resolver = useRef<((v: boolean) => void) | null>(null);

  function askConfirm(message: string): Promise<boolean> {
    setConfirmMsg(message);
    setConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }
  // Resuelve una sola vez (guard con resolver null) y cierra.
  function finish(v: boolean) {
    setConfirmOpen(false);
    const r = resolver.current;
    resolver.current = null;
    r?.(v);
  }

  useEffect(() => {
    if (!ref.current) return;
    let saveErrored = false;
    const unmount = mountEditor(ref.current, {
      payload: { slug, nombre, clippingId, data },
      onSave: async (_s: string, cid: string, state: unknown) => {
        const res = await saveEditorState(cid, state);
        if (!res.ok && !saveErrored) {
          saveErrored = true;
          toast.error("No se pudo guardar", {
            description: "Revisá tu conexión. Tus cambios están en pantalla pero no guardados.",
          });
        } else if (res.ok) {
          saveErrored = false;
        }
        return res;
      },
      onExport: async (
        _s: string,
        cid: string,
        html: string,
        state: unknown,
        resumen: { exclusivas: string; competencia: string } | null,
      ) => {
        const res = await exportClip(cid, html, state, resumen ?? undefined);
        if (!res.ok) toast.error("No se pudo guardar la copia", { description: res.error });
        else
          toast.success("Copiado para mail ✓", {
            description: resumen?.exclusivas || resumen?.competencia
              ? "Con resumen IA. Pegalo con Ctrl+V. Guardado en el historial."
              : "Pegalo con Ctrl+V. Guardado en el historial.",
          });
        return res;
      },
      resumen: (slug: string, sections: unknown) => generateResumen(slug, sections as never),
      confirm: askConfirm,
    });
    return unmount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, clippingId]);

  return (
    <>
      <div ref={ref} />
      <AlertDialog open={confirmOpen} onOpenChange={(o) => !o && finish(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar</AlertDialogTitle>
            <AlertDialogDescription>{confirmMsg}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => finish(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => finish(true)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
