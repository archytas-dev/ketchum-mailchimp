"use client";

import { useState } from "react";
import ClipEditorMount from "./ClipEditorMount";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

export type ClientPayload = {
  slug: string;
  nombre: string;
  clippingId: string | null;
  data: unknown;
  fecha: string | null;
};

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaBonita(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[m - 1]} ${y}`;
}

export default function PrincipalClient({ clients }: { clients: ClientPayload[] }) {
  const firstWithClip = clients.find((c) => c.clippingId) ?? clients[0];
  const [active, setActive] = useState(firstWithClip?.slug ?? "");
  const cur = clients.find((c) => c.slug === active);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border bg-card sticky top-0 z-30">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground hidden sm:inline">
            Clipping de hoy
          </span>
          <Select value={active} onValueChange={(v) => setActive(v ?? "")}>
            <SelectTrigger className="w-52 font-medium">
              <span>{cur?.nombre ?? "Elegí un cliente"}</span>
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.nombre}
                  {!c.clippingId ? " · sin clipping" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-sm text-muted-foreground hidden sm:inline">
          {cur?.fecha ? `Último clipping · ${fechaBonita(cur.fecha)}` : "Sin clipping"}
        </span>
      </div>

      <div className="flex-1 min-h-0">
        {cur && cur.clippingId ? (
          <ClipEditorMount
            key={cur.slug}
            slug={cur.slug}
            nombre={cur.nombre}
            clippingId={cur.clippingId}
            data={cur.data}
          />
        ) : (
          <div className="max-w-lg mx-auto px-6 py-16 text-center">
            <div className="bg-card rounded-xl border border-dashed border-border p-10">
              <p className="text-sm font-medium text-foreground">
                {cur?.nombre ?? "Cliente"}: todavía no hay ningún clipping cargado.
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Cuando el flujo de n8n escriba en Supabase, vas a poder editarlo acá.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
