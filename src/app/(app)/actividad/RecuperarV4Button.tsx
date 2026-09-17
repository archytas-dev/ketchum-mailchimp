"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, PlusCircle } from "lucide-react";
import { recuperarDescartadaV4 } from "./actions";

export default function RecuperarV4Button({ runId, candidataId, recuperada }: { runId: string; candidataId: string; recuperada: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(recuperada);
  if (done) return <span className="inline-flex size-7 items-center justify-center text-emerald-600" title="Agregada al clipping v4"><Check size={15} /></span>;
  return <button type="button" title="Agregar al clipping v4" disabled={busy} onClick={async () => {
    setBusy(true);
    const res = await recuperarDescartadaV4(runId, candidataId);
    if (res.ok) { setDone(true); router.refresh(); } else { setBusy(false); alert(res.error); }
  }} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:border-violet-500 hover:text-violet-700 disabled:opacity-50">
    {busy ? <Loader2 size={13} className="animate-spin" /> : <PlusCircle size={14} />}
  </button>;
}
