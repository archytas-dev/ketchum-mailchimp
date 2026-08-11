"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Undo2, PlusCircle, Pencil, Paintbrush } from "lucide-react";
import { stripHtml, type DiffRow } from "@/lib/pm-diff";
import { wordDiff, type WordDiffPart } from "@/lib/word-diff";

const TIPO_LABEL: Record<string, string> = {
  rojo: "Eliminada",
  verde: "Agregada — nueva",
  amarillo_nueva: "Agregada — ya la teníamos",
  amarillo_editada: "Editada",
};

const MOTIVO_LABEL: Record<string, string> = {
  no_aprobado_por_ia: "la IA no la aprobó",
  filtro_deterministico_quality_guard: "filtro de calidad post-IA",
};

const FASE_LABEL: Record<string, string> = { ai_filter: "Filtro IA", post_ai: "Post-IA" };

const CAMPO_LABEL: Record<string, string> = {
  titulo: "Título",
  snippet: "Copete",
  seccion: "Sección",
};

type Filtro = "todas" | "eliminadas" | "nuevas" | "editadas";

export default function DiffList({
  rows,
  precision,
  cobertura,
}: {
  rows: DiffRow[];
  precision: string;
  cobertura: string;
}) {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [abierta, setAbierta] = useState<string | null>(null);

  const conteos = useMemo(
    () => ({
      eliminadas: rows.filter((r) => r.tipo === "rojo").length,
      nuevas: rows.filter((r) => r.tipo === "verde").length,
      editadas: rows.filter((r) => r.tipo === "amarillo_nueva" || r.tipo === "amarillo_editada").length,
      soloFormato: rows.filter((r) => r.soloFormato).length,
    }),
    [rows],
  );

  const visibles = useMemo(() => {
    if (filtro === "eliminadas") return rows.filter((r) => r.tipo === "rojo");
    if (filtro === "nuevas") return rows.filter((r) => r.tipo === "verde");
    if (filtro === "editadas")
      return rows.filter((r) => r.tipo === "amarillo_nueva" || r.tipo === "amarillo_editada");
    return rows;
  }, [rows, filtro]);

  function toggleFiltro(f: Filtro) {
    setFiltro((cur) => (cur === f ? "todas" : f));
    setAbierta(null);
  }

  return (
    <>
      {/* Los tres primeros cuadros son ademas el filtro de la lista (click = filtrar, otro
          click = volver a todas). El cuarto es solo metrica. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <FiltroCard
          activo={filtro === "eliminadas"}
          onClick={() => toggleFiltro("eliminadas")}
          label="Eliminadas"
          valor={conteos.eliminadas}
          className="bg-red-50 border-red-200 text-red-700 ring-red-400"
        />
        <FiltroCard
          activo={filtro === "nuevas"}
          onClick={() => toggleFiltro("nuevas")}
          label="Nuevas (cobertura)"
          valor={conteos.nuevas}
          className="bg-green-50 border-green-200 text-green-700 ring-green-400"
        />
        <FiltroCard
          activo={filtro === "editadas"}
          onClick={() => toggleFiltro("editadas")}
          label="Recuperadas + editadas"
          valor={conteos.editadas}
          className="bg-amber-50 border-amber-200 text-amber-700 ring-amber-400"
        />
        <div className="rounded-lg bg-muted p-2 text-center">
          <p className="text-xs text-muted-foreground">Precisión / Cobertura</p>
          <p className="text-lg font-semibold text-foreground">
            {precision} / {cobertura}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Precisión = qué % de lo que mandamos sirvió. Cobertura = qué % del clipping final salió de
        nosotros. Rojo = ruido que mandamos, verde = hueco de cobertura (revisar el medio),
        amarillo-nueva = filtro mal calibrado (ver fase y motivo abajo). Tocá un cuadro para filtrar
        la lista.
        {conteos.soloFormato > 0 && (
          <>
            {" "}
            De las editadas, {conteos.soloFormato}{" "}
            {conteos.soloFormato === 1 ? "es solo resaltado" : "son solo resaltado"} de la marca — el
            texto quedó igual.
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin diferencias — el cliente no tocó nada.</p>
      ) : (
        <>
          {filtro !== "todas" && (
            <button
              type="button"
              onClick={() => toggleFiltro(filtro)}
              className="mb-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Ver todas ({rows.length})
            </button>
          )}

          {visibles.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna nota en esta categoría.</p>
          ) : (
            // Alto acotado: con 100 notas el scroll de la pagina se vuelve infinito (pedido de
            // Fede). ~24 filas colapsadas entran en este alto.
            <ul className="max-h-[34rem] overflow-y-auto space-y-1.5 pr-1">
              {visibles.map((r) => (
                <DiffItem
                  key={r.urlNorm}
                  row={r}
                  abierta={abierta === r.urlNorm}
                  onToggle={() => setAbierta((cur) => (cur === r.urlNorm ? null : r.urlNorm))}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function FiltroCard({
  activo,
  onClick,
  label,
  valor,
  className,
}: {
  activo: boolean;
  onClick: () => void;
  label: string;
  valor: number;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={
        "rounded-lg border p-2 text-center transition-all hover:brightness-95 " +
        (activo ? "ring-2 " : "") +
        className
      }
    >
      <p className="text-xs">{label}</p>
      <p className="text-lg font-semibold">{valor}</p>
    </button>
  );
}

function DiffItem({
  row,
  abierta,
  onToggle,
}: {
  row: DiffRow;
  abierta: boolean;
  onToggle: () => void;
}) {
  const d = row.descartada;
  const titulo = stripHtml(row.final?.titulo || row.base?.titulo || "") || row.urlNorm;
  const medio = row.final?.medio || row.base?.medio;
  const esEditada = row.tipo === "amarillo_editada";
  const Icon =
    row.tipo === "rojo"
      ? Undo2
      : row.tipo === "amarillo_editada"
        ? row.soloFormato
          ? Paintbrush
          : Pencil
        : PlusCircle;
  const color =
    row.tipo === "rojo" ? "text-red-600" : row.tipo === "verde" ? "text-green-600" : "text-amber-600";

  const detalle = (
    <>
      <Icon size={14} className={color + " shrink-0 mt-0.5"} />
      <div className="flex-1 min-w-0">
        <p className="text-foreground/90 truncate">{titulo}</p>
        <p className="text-xs text-muted-foreground">
          {medio ?? "medio desconocido"} ·{" "}
          {esEditada && row.soloFormato ? "Editada — solo resaltado" : TIPO_LABEL[row.tipo]}
          {d ? ` · ${FASE_LABEL[d.fase] ?? d.fase}: ${MOTIVO_LABEL[d.motivo] ?? d.motivo}` : ""}
        </p>
      </div>
    </>
  );

  if (!esEditada) {
    return <li className="flex items-start gap-2 text-sm">{detalle}</li>;
  }

  return (
    <li className="text-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierta}
        className="flex w-full items-start gap-2 rounded-md text-left hover:bg-muted/50 px-1 -mx-1 py-0.5"
      >
        {detalle}
        <ChevronDown
          size={14}
          className={
            "shrink-0 mt-0.5 text-muted-foreground transition-transform " + (abierta ? "rotate-180" : "")
          }
        />
      </button>
      {abierta && <DetalleEdicion row={row} />}
    </li>
  );
}

function DetalleEdicion({ row }: { row: DiffRow }) {
  const campos = row.campos ?? [];
  return (
    <div className="mt-2 mb-3 ml-6 rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      {row.soloFormato && (
        <p className="text-xs text-muted-foreground">
          El texto es idéntico — lo único que cambió es el resaltado de la marca.
        </p>
      )}
      {campos.map((campo) => {
        const antes = campo === "seccion" ? (row.base?.seccion ?? "—") : (row.base?.[campo] ?? "");
        const despues = campo === "seccion" ? (row.final?.seccion ?? "—") : (row.final?.[campo] ?? "");
        const antesPlano = stripHtml(antes);
        const despuesPlano = stripHtml(despues);
        const { izq, der } = wordDiff(antesPlano, despuesPlano);
        return (
          <div key={campo} className="space-y-1">
            <p className="text-xs font-medium text-foreground/80">{CAMPO_LABEL[campo] ?? campo}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Columna titulo="Lo que mandamos" partes={izq} vacio={!antesPlano} />
              <Columna titulo="Como quedó" partes={der} vacio={!despuesPlano} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Columna({
  titulo,
  partes,
  vacio,
}: {
  titulo: string;
  partes: WordDiffPart[];
  vacio: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{titulo}</p>
      {vacio ? (
        <p className="text-xs text-muted-foreground italic">(vacío)</p>
      ) : (
        <p className="text-xs leading-relaxed text-foreground/90">
          {partes.map((p, i) => (
            <span
              key={i}
              className={
                p.tipo === "quitado"
                  ? "bg-red-100 text-red-800 line-through decoration-red-400"
                  : p.tipo === "agregado"
                    ? "bg-green-100 text-green-800"
                    : ""
              }
            >
              {p.text}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
