"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Check, Pencil, X, Info, Sparkles } from "lucide-react";
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
  lookupTiers,
  setTierMedio,
  listMediosConTier,
  type PrecargaRow,
  type MedioConocido,
} from "./actions";
import { sectionsFor, defaultSection } from "@/lib/clip/canon";
import { tierDotClasses, tierBadgeClasses } from "@/lib/tier";

// Sin tildes ni mayúsculas, para que "Diario Popular" matchee con "diario popular" o "popular".
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function filtrarMedios(medios: MedioConocido[], query: string): MedioConocido[] {
  const q = normalizar(query);
  if (!q) return [];
  const empieza: MedioConocido[] = [];
  const contiene: MedioConocido[] = [];
  for (const m of medios) {
    const n = normalizar(m.nombre);
    if (n === q) continue; // ya está escrito tal cual, no hace falta sugerirlo
    if (n.startsWith(q)) empieza.push(m);
    else if (n.includes(q)) contiene.push(m);
  }
  return [...empieza, ...contiene].slice(0, 8);
}

// Autocomplete liviano (sin dependencias nuevas): input + lista de sugerencias posicionada
// debajo. Al elegir una, además de completar el nombre trae el tier que ya tiene ese medio
// para este cliente, para que no haya que cargarlo a mano de nuevo.
function MedioAutocomplete({
  value,
  medios,
  onChange,
  onSelectMedio,
  onBlurExtra,
}: {
  value: string;
  medios: MedioConocido[];
  onChange: (v: string) => void;
  onSelectMedio: (m: MedioConocido) => void;
  onBlurExtra?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sugerencias = open ? filtrarMedios(medios, value) : [];
  return (
    <div className="relative">
      <input
        placeholder="Medio"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay para que el mousedown de una sugerencia llegue a disparar antes de cerrar.
          setTimeout(() => setOpen(false), 150);
          onBlurExtra?.();
        }}
        className="border rounded-md px-2 py-1.5 text-sm bg-background w-full"
      />
      {sugerencias.length ? (
        <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-md border bg-popover shadow-md text-sm">
          {sugerencias.map((m) => (
            <li key={m.nombre}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // evita el blur antes de procesar el click
                  onSelectMedio(m);
                  setOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 hover:bg-accent flex items-center justify-between gap-2"
              >
                <span className="truncate">{m.nombre}</span>
                <span className={"text-xs shrink-0 " + (m.tier ? "" : "text-muted-foreground")}>
                  {m.tier ? `Tier ${m.tier}` : "Sin tier"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export type ClientOpt = { id: string; slug: string; nombre: string };

type Draft = {
  medio: string;
  titulo: string;
  url: string;
  snippet: string;
  seccion: string;
  // Fecha PROPIA de la nota (ej. una nota de ayer que se precarga para el clipping de
  // mañana) -- distinta de la "Fecha del clipping" de arriba, que es el día donde va a
  // aparecer. YYYY-MM-DD, o "" = sin especificar.
  pubDate: string;
  loading?: boolean;
  // Tier del MEDIO (tabla `tiers`), no de la nota: se muestra el que ya tiene y se puede
  // cambiar desde acá. `undefined` = todavía no se consultó.
  tier?: number | null;
};
type EditFields = { medio: string; titulo: string; url: string; snippet: string; seccion: string; pubDate: string };

// Fecha de hoy/mañana en horario AR (UTC-3), formato YYYY-MM-DD.
function todayAR(): string {
  const now = new Date(Date.now() - 3 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}
function tomorrowAR(): string {
  const now = new Date(Date.now() - 3 * 3600 * 1000 + 24 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

const emptyDraft = (seccion: string): Draft => ({ medio: "", titulo: "", url: "", snippet: "", seccion, pubDate: todayAR() });

// Etiqueta chica y consistente arriba de un campo -- mismo patrón en los dos formularios de
// Precarga, para que ningún campo dependa solo del placeholder (que desaparece al escribir).
// `htmlFor` asocia el label con su campo (ej. un <input type="date"> aparte, no anidado) para
// que clickear el texto del label también lo abra/enfoque -- no solo el campo en sí.
function FieldLabel({ children, hint, htmlFor }: { children: ReactNode; hint?: string; htmlFor?: string }) {
  const content = (
    <>
      {children}
      {hint ? <InfoHint text={hint} /> : null}
    </>
  );
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-medium text-muted-foreground w-fit cursor-pointer">
        {content}
      </label>
    );
  }
  return <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{content}</span>;
}

// Ícono de ayuda con tooltip nativo del navegador (title) -- mismo patrón liviano que ya usa
// el resto de la app (ej. el trigger de Tier), pero con un ícono visible al lado del label
// para que se note que hay más info, en vez de depender de un title escondido en otro
// elemento. `tabIndex` lo hace alcanzable con teclado. `stopPropagation` evita que un click acá
// (para leer el tooltip) dispare de rebote la acción del label que lo contiene (ej. abrir un
// date picker).
function InfoHint({ text }: { text: string }) {
  return (
    <span
      title={text}
      tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex text-muted-foreground/70 hover:text-foreground cursor-help"
    >
      <Info size={12} />
    </span>
  );
}

// Input de fecha que abre el calendario con cualquier click en el campo, no solo en el
// iconito nativo -- Chrome únicamente abre el picker con un click real sobre ese ícono chico;
// clickear los números o un <label for=...> asociado solo enfoca, no lo despliega.
// `showPicker()` lo fuerza a abrir en respuesta a cualquiera de los dos.
function DateInput({
  id,
  value,
  onChange,
  className,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  function openPicker() {
    const el = ref.current;
    if (el && typeof el.showPicker === "function") {
      try {
        el.showPicker();
      } catch {
        // Sigue funcionando como input normal aunque el navegador no deje abrir el picker acá
        // (ej. sin gesto de usuario válido) -- no hace falta avisar nada.
      }
    }
  }
  return (
    <input
      ref={ref}
      id={id}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={openPicker}
      className={className ?? "border rounded-md px-2 py-1.5 text-sm bg-background w-full"}
    />
  );
}

const HINT_FECHA_NOTA =
  "Cuándo se publicó la noticia -- puede ser de ayer o de otro día. No es la fecha del clipping de arriba: esa es el día en que la nota va a aparecer.";
const HINT_TIER =
  "El tier es del medio, no de esta nota puntual: se guarda para todas las notas de ese medio, igual que en Base de Datos.";
const HINT_MEDIO =
  "Escribí el nombre del medio. Si ya está cargado en Base de Datos aparece como sugerencia -- elegirlo completa el tier solo.";
// Versión combinada para el encabezado de la grilla grupal: ahí Tier no tiene columna propia
// (va debajo de Medio en la misma celda), así que el hint cubre las dos cosas juntas.
const HINT_MEDIO_TIER = HINT_MEDIO + " " + HINT_TIER;
const HINT_NOTA_COL =
  "URL, título y descripción de la nota. Si el título queda marcado en naranja, no se pudo traer solo -- completalo a mano o quitá la fila.";
const HINT_SECCION_LOTE =
  "Se aplica a todas las URLs que pegues ahora. Después, en la previsualización, podés cambiar la sección de cada nota por separado.";

// Select de Tier reutilizado por Individual y por cada fila de la previsualización grupal.
function TierSelect({
  tier,
  onChange,
  disabled,
}: {
  tier: number | null | undefined;
  onChange: (t: number | null) => void;
  disabled: boolean;
}) {
  return (
    <Select value={tier ? String(tier) : "none"} onValueChange={(v) => v && onChange(v === "none" ? null : Number(v))} disabled={disabled}>
      <SelectTrigger
        className={"h-8 text-sm border-transparent font-medium " + tierBadgeClasses((tier ?? null) as 1 | 2 | 3 | 4 | null)}
        title={disabled ? "Escribí el medio para poder asignarle un tier" : "Tier del medio — se guarda para todas sus notas, no solo esta"}
      >
        <SelectValue>
          {(value: string) => (
            <span className="flex items-center gap-1.5">
              <span className={"size-1.5 rounded-full " + tierDotClasses(value === "none" ? null : (Number(value) as 1 | 2 | 3 | 4))} />
              {value === "none" ? "Sin tier" : `Tier ${value}`}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Sin asignar</SelectItem>
        <SelectItem value="1">Tier 1</SelectItem>
        <SelectItem value="2">Tier 2</SelectItem>
        <SelectItem value="3">Tier 3</SelectItem>
        <SelectItem value="4">Tier 4</SelectItem>
      </SelectContent>
    </Select>
  );
}

export default function PrecargaClient({ clients }: { clients: ClientOpt[] }) {
  // [19/08] Cutover: solo se puede elegir la herramienta real (-test). `clients` sigue
  // llegando SIN filtrar desde la página porque configClientId necesita poder resolver el
  // par -- medios/tiers (el catálogo de autocompletado) vive bajo el client_id BASE, no el -test.
  const seleccionables = clients.filter((c) => c.slug.endsWith("-test"));
  const [clientId, setClientId] = useState(seleccionables[0]?.id ?? "");
  const [fecha, setFecha] = useState<string>(() => tomorrowAR());
  const clientSlug = clients.find((c) => c.id === clientId)?.slug ?? "";
  // La configuracion (medios/tiers) vive bajo el cliente base (los 4 workflows v3 la piden
  // con get_config_clipping(p_slug: 'booking'|'bms'|'mars'|'msd')).
  const slugBaseCfg = clientSlug.replace(/-test$/, "");
  const configClientId = clients.find((c) => c.slug === slugBaseCfg)?.id ?? clientId;
  // "Áreas Terapéuticas" (BMS) es solo un separador visual en el mail, nunca lleva notas propias.
  const sections = sectionsFor(clientSlug).filter((s) => s !== "Áreas Terapéuticas");
  const defaultSeccion = defaultSection(clientSlug);

  const [existing, setExisting] = useState<PrecargaRow[]>([]);

  // ---------- Precarga individual: una nota a la vez, se guarda al toque, sin armar lista ----------
  const [individual, setIndividual] = useState<Draft>(() => emptyDraft(defaultSeccion));
  const [individualSaving, setIndividualSaving] = useState(false);

  // ---------- Precarga grupal: pegar varias URLs, previsualizar y corregir, guardar juntas ----------
  const [bulk, setBulk] = useState("");
  // Sección para el lote pegado — se aplica a todas las URLs de ese pegado (caso real: 27
  // réplicas de la misma gacetilla van todas a la misma sección). El medio ya no se pide acá:
  // "Traer datos" lo autocompleta solo por match de dominio o nombre del sitio.
  const [bulkSeccion, setBulkSeccion] = useState(defaultSeccion);
  const [bulkPreview, setBulkPreview] = useState<Draft[] | null>(null);
  const [bulkFetching, setBulkFetching] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  // Edición inline de una precargada + borrado con confirmación.
  const [editId, setEditId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({ medio: "", titulo: "", url: "", snippet: "", seccion: defaultSeccion, pubDate: "" });
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

  // Catálogo de medios conocidos del cliente (con su tier), para el autocomplete del campo
  // Medio — se recarga al cambiar de cliente.
  const [mediosConocidos, setMediosConocidos] = useState<MedioConocido[]>([]);
  useEffect(() => {
    let alive = true;
    if (!configClientId) return;
    listMediosConTier(configClientId).then((res) => {
      if (alive && res.ok) setMediosConocidos(res.data ?? []);
    });
    return () => {
      alive = false;
    };
  }, [configClientId]);

  // Cambiar de cliente reinicia los dos formularios (las secciones disponibles son otras).
  // Patrón "ajustar estado durante el render" en vez de un efecto (no es una sincronización externa).
  const [prevClientId, setPrevClientId] = useState(clientId);
  if (clientId !== prevClientId) {
    setPrevClientId(clientId);
    setIndividual(emptyDraft(defaultSeccion));
    setBulk("");
    setBulkSeccion(defaultSeccion);
    setBulkPreview(null);
  }

  // ================= Individual =================

  function setIndividualField(patch: Partial<Draft>) {
    setIndividual((d) => ({ ...d, ...patch }));
  }

  // Al terminar de escribir el medio, trae el tier que ya tiene cargado para ese cliente:
  // muestra lo que va a salir en el mail sin tener que ir a Base de Datos a chequearlo.
  async function individualRefrescarTier() {
    const medio = individual.medio.trim();
    if (!medio) return setIndividualField({ tier: undefined });
    const res = await lookupTiers(configClientId, [medio]);
    if (!res.ok) return;
    setIndividualField({ tier: res.data?.[medio]?.tier ?? null });
  }

  // Cambiar el tier acá escribe en `tiers`, o sea que afecta al medio entero, no solo a esta
  // nota. Es a propósito: es el mismo dato que edita Base de Datos.
  async function individualHandleTier(tier: number | null) {
    const medio = individual.medio.trim();
    const res = await setTierMedio(configClientId, medio, tier);
    if (!res.ok) return toast.error(res.error);
    setIndividualField({ tier });
    toast.success(tier ? `${medio} quedó como Tier ${tier} para este cliente.` : `${medio} quedó sin tier asignado.`);
  }

  async function individualTraer() {
    const url = individual.url.trim();
    if (!url) return;
    // Si ya hay algo escrito en Medio, no se pisa -- el autocompletado solo llena lo vacío.
    const medioYaEscrito = individual.medio.trim();
    setIndividualField({ loading: true });
    const res = await fetchMeta(configClientId, url);
    setIndividual((d) => ({
      ...d,
      loading: false,
      titulo: res.titulo || d.titulo,
      snippet: res.snippet || d.snippet,
      medio: medioYaEscrito || res.medio || d.medio,
    }));
    if (!res.ok) toast.error("No se pudo leer", { description: res.error });
    else if (!res.titulo && !res.snippet) toast.warning("La página no expuso título ni descripción");
    if (!medioYaEscrito && res.medio) {
      const tRes = await lookupTiers(configClientId, [res.medio]);
      if (tRes.ok) setIndividualField({ tier: tRes.data?.[res.medio]?.tier ?? null });
    }
  }

  async function individualAgregar() {
    if (!clientId || !fecha || individual.loading) return;
    if (!individual.titulo.trim() || !individual.url.trim()) {
      toast.error("Faltan datos", { description: "La nota necesita al menos título y URL — usá \"Traer\" o completalos a mano." });
      return;
    }
    setIndividualSaving(true);
    const res = await addPrecarga(clientId, fecha, [
      {
        medio: individual.medio,
        titulo: individual.titulo,
        url: individual.url,
        snippet: individual.snippet,
        seccion: individual.seccion || defaultSeccion,
        pubDate: individual.pubDate,
      },
    ]);
    setIndividualSaving(false);
    if (!res.ok) {
      toast.error("No se pudo precargar", { description: res.error });
      return;
    }
    toast.success("Nota precargada");
    setIndividual(emptyDraft(defaultSeccion));
    void refresh();
  }

  // ================= Grupal =================

  function parseBulkLines(): Draft[] {
    const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((l) => {
      const parts = l.split("|").map((p) => p.trim());
      const medioLinea = parts.length >= 2 ? parts[0] : "";
      const url = parts.length >= 2 ? parts[1] : parts[0];
      // `loading:true` desde el arranque para las tres — con concurrencia 5, una fila puede
      // estar todavía en cola (ni empezó) sin que eso sea distinguible de "no encontró nada"
      // si no se marca explícitamente como pendiente.
      return { medio: medioLinea, url, titulo: "", snippet: "", seccion: bulkSeccion, pubDate: todayAR(), loading: true };
    });
  }

  // Trae título/descripción de todas las URLs pegadas en paralelo (concurrencia 5, no una por
  // una) y arma la previsualización editable. A propósito separado de "guardar": acá el
  // usuario VE el resultado del autocompletado antes de precargar nada, nunca hay un guardado
  // a ciegas mientras todavía se está buscando algo.
  async function bulkTraer() {
    const nuevos = parseBulkLines();
    if (!nuevos.length) {
      toast.error("Pegá al menos una URL");
      return;
    }
    setBulkFetching(true);
    setBulkPreview(nuevos);
    // Copia local que se muta en paralelo con el state -- después del loop hace falta el medio
    // ya resuelto (línea, o el que matcheó/sugirió el fetch) para el lookup de tiers en lote,
    // y el state de React no se puede leer de vuelta de forma síncrona acá.
    const finalRows = nuevos.map((n) => ({ ...n }));

    let cursor = 0;
    async function worker() {
      while (cursor < nuevos.length) {
        const idx = cursor++;
        const url = nuevos[idx].url.trim();
        if (!url) {
          finalRows[idx].loading = false;
          setBulkPreview((prev) => prev?.map((x, j) => (j === idx ? { ...x, loading: false } : x)) ?? prev);
          continue;
        }
        // Si la línea ya traía medio (formato "medio | url"), no se pisa.
        const medioYaEscrito = nuevos[idx].medio.trim();
        const res = await fetchMeta(configClientId, url);
        const medioFinal = medioYaEscrito || res.medio || "";
        finalRows[idx] = {
          ...finalRows[idx],
          loading: false,
          titulo: res.titulo || finalRows[idx].titulo,
          snippet: res.snippet || finalRows[idx].snippet,
          medio: medioFinal,
        };
        setBulkPreview((prev) =>
          prev?.map((x, j) =>
            j === idx
              ? { ...x, loading: false, titulo: res.titulo || x.titulo, snippet: res.snippet || x.snippet, medio: medioFinal || x.medio }
              : x,
          ) ?? prev,
        );
      }
    }
    await Promise.all(Array.from({ length: Math.min(5, nuevos.length) }, () => worker()));

    const medios = [...new Set(finalRows.map((n) => n.medio.trim()).filter(Boolean))];
    if (medios.length) {
      const tiersRes = await lookupTiers(configClientId, medios);
      if (tiersRes.ok && tiersRes.data) {
        const porMedio = tiersRes.data;
        setBulkPreview((prev) =>
          prev?.map((x) => (x.medio.trim() && x.tier === undefined ? { ...x, tier: porMedio[x.medio.trim()]?.tier ?? null } : x)) ?? prev,
        );
      }
    }
    setBulkFetching(false);
  }

  // Cambiar el tier de una fila de la previsualización escribe en `tiers` (afecta al medio
  // entero) igual que en Individual y en Base de Datos.
  async function bulkPreviewHandleTier(i: number, medio: string, tier: number | null) {
    const res = await setTierMedio(configClientId, medio, tier);
    if (!res.ok) return toast.error(res.error);
    bulkPreviewSetRow(i, { tier });
  }

  function bulkPreviewSetRow(i: number, patch: Partial<Draft>) {
    setBulkPreview((prev) => prev?.map((x, j) => (j === i ? { ...x, ...patch } : x)) ?? prev);
  }
  function bulkPreviewRemove(i: number) {
    setBulkPreview((prev) => {
      const next = prev?.filter((_, j) => j !== i) ?? null;
      return next && next.length ? next : null;
    });
  }
  function bulkCancelar() {
    setBulkPreview(null);
  }

  async function bulkGuardar() {
    if (!clientId || !fecha || !bulkPreview) return;
    const notes = bulkPreview
      .filter((r) => r.titulo.trim() && r.url.trim())
      .map((r) => ({
        medio: r.medio,
        titulo: r.titulo,
        url: r.url,
        snippet: r.snippet,
        seccion: r.seccion || defaultSeccion,
        pubDate: r.pubDate,
      }));
    if (!notes.length) {
      toast.error("Nada para guardar", { description: "Cada nota necesita al menos título y URL." });
      return;
    }
    setBulkSaving(true);
    const res = await addPrecarga(clientId, fecha, notes);
    setBulkSaving(false);
    if (!res.ok) {
      toast.error("No se pudo precargar", { description: res.error });
      return;
    }
    toast.success(`${res.count} nota(s) precargada(s)`);
    setBulk("");
    setBulkPreview(null);
    void refresh();
  }

  // ================= Existentes (edición inline + borrado) =================

  function startEdit(e: PrecargaRow) {
    setEditId(e.id);
    setEditFields({
      medio: e.medio ?? "",
      titulo: e.titulo ?? "",
      url: e.url ?? "",
      snippet: e.snippet ?? "",
      seccion: e.seccion || defaultSeccion,
      pubDate: e.pub_date ?? "",
    });
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
            <SelectTrigger className="min-w-[240px] h-10 text-sm font-medium bg-background shadow-sm">
              <SelectValue placeholder="Elegí un cliente">
                {(value: string) => clients.find((c) => c.id === value)?.nombre ?? ""}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {seleccionables.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-sm">
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label htmlFor="fecha-clipping" className="flex flex-col gap-1.5 cursor-pointer">
          <span className="flex items-center gap-1 text-sm font-medium">
            Fecha del clipping
            <InfoHint text="El día en que esta precarga va a aparecer en el clipping. No es la fecha en que se publicó la noticia — eso se elige nota por nota más abajo." />
          </span>
          <DateInput
            id="fecha-clipping"
            value={fecha}
            onChange={setFecha}
            className="border rounded-md px-3 h-10 text-sm bg-background shadow-sm"
          />
        </label>
      </div>

      {/* Ya precargadas — arriba para ver de una lo que hay */}
      <section className="space-y-2">
        <h2 className="font-medium">
          Precargadas de {clienteNombre} para {fecha} · {pendientes.length} pendiente
          {pendientes.length === 1 ? "" : "s"}
        </h2>
        {volcadas.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            &ldquo;Volcada&rdquo; quiere decir que ya entró al clipping del día — esas no se pueden editar ni borrar
            desde acá.
          </p>
        ) : null}
        {existing.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada precargado todavía para este cliente y fecha.</p>
        ) : (
          <ul className="space-y-2">
            {pendientes.map((e) =>
              editId === e.id ? (
                <li key={e.id} className="border rounded-md p-3 space-y-2 bg-muted/30">
                  <div className="flex gap-2">
                    <input
                      value={editFields.medio}
                      onChange={(ev) => setEditFields((f) => ({ ...f, medio: ev.target.value }))}
                      placeholder="Medio"
                      className="border rounded-md px-2 py-1.5 text-sm bg-background flex-1"
                    />
                    <Select
                      value={editFields.seccion}
                      onValueChange={(v) => v && setEditFields((f) => ({ ...f, seccion: v }))}
                    >
                      <SelectTrigger className="w-48 text-sm bg-background">
                        <SelectValue placeholder="Sección" />
                      </SelectTrigger>
                      <SelectContent>
                        {sections.map((s) => (
                          <SelectItem key={s} value={s} className="text-sm">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Fecha de la nota (si es de otro día)
                    <DateInput
                      value={editFields.pubDate}
                      onChange={(v) => setEditFields((f) => ({ ...f, pubDate: v }))}
                      className="border rounded-md px-2 py-1 text-sm bg-background"
                    />
                  </label>
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
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{e.medio || "—"}</span>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                        {e.seccion || defaultSeccion}
                      </span>
                      {e.pub_date ? (
                        <span
                          className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0"
                          title="Fecha propia de la nota"
                        >
                          Nota del {e.pub_date}
                        </span>
                      ) : null}
                    </div>
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
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                  {e.seccion || defaultSeccion}
                </span>
                <span className="flex-1 truncate">{e.titulo}</span>
                <span className="text-xs text-muted-foreground">volcada</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Precarga individual */}
      <section className="border rounded-lg p-4 space-y-3">
        <div>
          <h2 className="font-medium">Precarga individual</h2>
          <p className="text-sm text-muted-foreground">Una noticia por vez — se guarda al toque, sin armar una lista.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel hint={HINT_MEDIO}>Medio</FieldLabel>
            <MedioAutocomplete
              value={individual.medio}
              medios={mediosConocidos}
              onChange={(v) => setIndividualField({ medio: v })}
              onSelectMedio={(m) => setIndividualField({ medio: m.nombre, tier: m.tier })}
              onBlurExtra={individualRefrescarTier}
            />
            <FieldLabel hint={HINT_TIER}>Tier</FieldLabel>
            <TierSelect tier={individual.tier} onChange={individualHandleTier} disabled={!individual.medio.trim()} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Sección</FieldLabel>
            <Select value={individual.seccion} onValueChange={(v) => v && setIndividualField({ seccion: v })}>
              <SelectTrigger className="text-sm bg-background w-full">
                <SelectValue placeholder="Sección" />
              </SelectTrigger>
              <SelectContent>
                {sections.map((s) => (
                  <SelectItem key={s} value={s} className="text-sm">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="fecha-nota-individual" hint={HINT_FECHA_NOTA}>
              Fecha de la nota
            </FieldLabel>
            <DateInput
              id="fecha-nota-individual"
              value={individual.pubDate}
              onChange={(v) => setIndividualField({ pubDate: v })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel>URL</FieldLabel>
          <div className="flex gap-2">
            <input
              placeholder="https://…"
              value={individual.url}
              onChange={(e) => setIndividualField({ url: e.target.value })}
              className="border rounded-md px-2 py-1.5 text-sm bg-background flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={individual.loading}
              onClick={individualTraer}
              title="Completa título, descripción y, si el medio está vacío, también el medio y su tier"
            >
              <Sparkles size={14} /> {individual.loading ? "Buscando..." : "Autocompletar"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Título</FieldLabel>
          <input
            placeholder="Título de la nota"
            value={individual.titulo}
            onChange={(e) => setIndividualField({ titulo: e.target.value })}
            className="border rounded-md px-2 py-1.5 text-sm bg-background w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Descripción</FieldLabel>
          <textarea
            placeholder="Resumen o copete"
            value={individual.snippet}
            onChange={(e) => setIndividualField({ snippet: e.target.value })}
            rows={2}
            className="border rounded-md px-2 py-1.5 text-sm bg-background w-full resize-y"
          />
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={individualAgregar} disabled={individualSaving || individual.loading}>
            <Plus size={16} /> {individualSaving ? "Guardando..." : "Agregar esta nota"}
          </Button>
        </div>
      </section>

      {/* Precarga grupal */}
      <section className="border rounded-lg p-4 space-y-3">
        <div>
          <h2 className="font-medium">Precarga grupal</h2>
          <p className="text-sm text-muted-foreground">
            Pegá varias URLs de una — primero traé los datos, revisá lo que se encontró, y recién ahí guardás todas juntas.
          </p>
        </div>

        {!bulkPreview ? (
          <>
            <div className="flex flex-col gap-1 max-w-xs">
              <FieldLabel htmlFor="bulk-seccion" hint={HINT_SECCION_LOTE}>
                Sección para este lote
              </FieldLabel>
              <Select value={bulkSeccion} onValueChange={(v) => v && setBulkSeccion(v)}>
                <SelectTrigger id="bulk-seccion" className="text-sm bg-background w-full">
                  <SelectValue placeholder="Sección" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s} value={s} className="text-sm">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel hint="Pegá una URL por línea. Si escribís el medio con «medio | url» se usa ese; si no, se busca solo por dominio en Base de Datos o por el nombre del sitio.">
                URLs a precargar
              </FieldLabel>
              <textarea
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                rows={5}
                className="border rounded-md px-2 py-1.5 text-sm bg-background w-full"
                placeholder={"La Voz | https://...\nhttps://..."}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Una por línea. Formato <code>medio | url</code> o solo <code>url</code> — si no ponés el medio, se
              autocompleta solo al buscar los datos.
            </p>
            <div className="flex justify-end">
              <Button type="button" onClick={bulkTraer} disabled={!bulk.trim()}>
                <Sparkles size={14} /> Autocompletar todas
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {bulkFetching
                ? "Buscando título y descripción…"
                : `${bulkPreview.length} nota(s) — revisá y corregí lo que haga falta antes de guardar.`}
            </p>
            {/* Encabezado de columnas — una sola vez arriba de la lista, no repetido por fila. */}
            <div className="hidden md:grid md:grid-cols-[1.4fr_1fr_1fr_2.2fr_auto] gap-2 px-1">
              <FieldLabel hint={HINT_MEDIO_TIER}>Medio y tier</FieldLabel>
              <FieldLabel>Sección</FieldLabel>
              <FieldLabel hint={HINT_FECHA_NOTA}>Fecha de la nota</FieldLabel>
              <FieldLabel hint={HINT_NOTA_COL}>Nota</FieldLabel>
              <span />
            </div>
            <div className="space-y-3">
              {bulkPreview.map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_2.2fr_auto] gap-2 items-start border-b pb-3"
                >
                  <div className="flex flex-col gap-2">
                    <span className="md:hidden">
                      <FieldLabel hint={HINT_MEDIO_TIER}>Medio y tier</FieldLabel>
                    </span>
                    <MedioAutocomplete
                      value={r.medio}
                      medios={mediosConocidos}
                      onChange={(v) => bulkPreviewSetRow(i, { medio: v })}
                      onSelectMedio={(m) => bulkPreviewSetRow(i, { medio: m.nombre, tier: m.tier })}
                    />
                    <TierSelect
                      tier={r.tier}
                      onChange={(t) => bulkPreviewHandleTier(i, r.medio.trim(), t)}
                      disabled={!r.medio.trim()}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="md:hidden">
                      <FieldLabel>Sección</FieldLabel>
                    </span>
                    <Select value={r.seccion} onValueChange={(v) => v && bulkPreviewSetRow(i, { seccion: v })}>
                      <SelectTrigger className="text-sm bg-background w-full">
                        <SelectValue placeholder="Sección" />
                      </SelectTrigger>
                      <SelectContent>
                        {sections.map((s) => (
                          <SelectItem key={s} value={s} className="text-sm">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="md:hidden">
                      <FieldLabel htmlFor={`fecha-nota-bulk-${i}`} hint={HINT_FECHA_NOTA}>
                        Fecha de la nota
                      </FieldLabel>
                    </span>
                    <DateInput
                      id={`fecha-nota-bulk-${i}`}
                      value={r.pubDate}
                      onChange={(v) => bulkPreviewSetRow(i, { pubDate: v })}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      placeholder="URL"
                      value={r.url}
                      onChange={(e) => bulkPreviewSetRow(i, { url: e.target.value })}
                      className="border rounded-md px-2 py-1.5 text-sm bg-background"
                    />
                    <input
                      placeholder="Título"
                      value={r.titulo}
                      onChange={(e) => bulkPreviewSetRow(i, { titulo: e.target.value })}
                      className={
                        "border rounded-md px-2 py-1.5 text-sm bg-background" +
                        (!r.loading && !r.titulo.trim() ? " border-amber-500" : "")
                      }
                    />
                    <textarea
                      placeholder="Descripción"
                      value={r.snippet}
                      onChange={(e) => bulkPreviewSetRow(i, { snippet: e.target.value })}
                      rows={2}
                      className="border rounded-md px-2 py-1.5 text-sm bg-background resize-y"
                    />
                    {r.loading ? (
                      <span className="text-xs text-muted-foreground">Buscando…</span>
                    ) : !r.titulo.trim() ? (
                      <span className="text-xs text-amber-600">No se encontró título — completalo a mano o quitá la fila.</span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={bulkFetching}
                    onClick={() => bulkPreviewRemove(i)}
                    title="Quitar fila"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center">
              <Button type="button" variant="outline" onClick={bulkCancelar} disabled={bulkFetching}>
                <X size={14} /> Cancelar
              </Button>
              <Button type="button" onClick={bulkGuardar} disabled={bulkFetching || bulkSaving}>
                <Check size={16} />{" "}
                {bulkSaving ? "Guardando..." : bulkFetching ? "Esperá a que termine…" : `Guardar ${bulkPreview.length} nota(s)`}
              </Button>
            </div>
          </>
        )}
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
