"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export default function CopyLinkButton({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      title="Copiar link"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
      }}
      className="inline-flex items-center justify-center rounded-md border border-border bg-card w-7 h-7 text-muted-foreground hover:text-brand hover:border-brand shrink-0"
    >
      {copiado ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
