"use client";

import { useState } from "react";
import { Newspaper, Radio } from "lucide-react";

type Dataset = { secciones: [string, number][]; topMedios: [string, number][] };

export default function SeccionMediosTabs({
  exportadas,
  encontradas,
}: {
  exportadas: Dataset;
  encontradas: Dataset;
}) {
  const [tab, setTab] = useState<"exportadas" | "encontradas">("exportadas");
  const d = tab === "exportadas" ? exportadas : encontradas;
  const maxSec = Math.max(1, ...d.secciones.map((s) => s[1]));

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg bg-muted p-1">
        <button
          onClick={() => setTab("exportadas")}
          className={
            "px-3 py-1.5 text-sm font-medium rounded-md transition " +
            (tab === "exportadas" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
          }
        >
          Exportadas
        </button>
        <button
          onClick={() => setTab("encontradas")}
          className={
            "px-3 py-1.5 text-sm font-medium rounded-md transition " +
            (tab === "encontradas" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
          }
        >
          Encontradas
        </button>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        {tab === "exportadas"
          ? "Notas que quedaron en lo que se copió para el mail."
          : "Todas las notas que el sistema trajo (antes de editar)."}
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <Newspaper size={15} className="text-muted-foreground" /> Notas por sección · últimos 30 días
          </h2>
          {d.secciones.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <div className="space-y-2">
              {d.secciones.map(([sec, n]) => (
                <div key={sec} className="flex items-center gap-3">
                  <span className="text-xs text-foreground/80 w-40 truncate shrink-0">{sec}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${(n / maxSec) * 100}%` }} />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground w-8 text-right">{n}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <Radio size={15} className="text-muted-foreground" /> Top medios · últimos 30 días
          </h2>
          {d.topMedios.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <ol className="space-y-1.5">
              {d.topMedios.map(([med, n], i) => (
                <li key={med} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground/70 w-4 text-right">{i + 1}</span>
                  <span className="text-foreground/90 flex-1 truncate">{med}</span>
                  <span className="text-xs font-medium text-muted-foreground">{n}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
