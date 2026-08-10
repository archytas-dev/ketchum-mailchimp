"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusCircle, Loader2, Check } from "lucide-react";
import { agregarDescartadaAClipping } from "./actions";

export default function RecuperarButton({ descartadaId, clientId }: { descartadaId: string; clientId: string }) {
  const router = useRouter();
  const [estado, setEstado] = useState<"idle" | "cargando" | "hecho">("idle");

  if (estado === "hecho") {
    return (
      <span className="inline-flex items-center justify-center rounded-md w-7 h-7 text-green-600 shrink-0" title="Agregada">
        <Check size={14} />
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Agregar directo al clipping de hoy (Principal)"
      disabled={estado === "cargando"}
      onClick={async () => {
        setEstado("cargando");
        const res = await agregarDescartadaAClipping(descartadaId, clientId);
        if (res.ok) {
          setEstado("hecho");
          router.refresh();
        } else {
          setEstado("idle");
          alert(res.error);
        }
      }}
      className="inline-flex items-center justify-center rounded-md border border-border bg-card w-7 h-7 text-muted-foreground hover:text-brand hover:border-brand disabled:opacity-50 shrink-0"
    >
      {estado === "cargando" ? <Loader2 size={13} className="animate-spin" /> : <PlusCircle size={13} />}
    </button>
  );
}
