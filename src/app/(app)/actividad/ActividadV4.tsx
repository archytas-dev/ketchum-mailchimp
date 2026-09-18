import { createClient } from "@/lib/supabase/server";
import { planoActivo, tabla } from "@/lib/data-plane";
import ActividadFilter from "./ActividadFilter";
import RecuperarV4Button from "./RecuperarV4Button";
import Link from "next/link";
import { Clock3, FilePenLine, FilterX, Layers3, PlayCircle } from "lucide-react";

type ClientOpt = { id: string; slug: string; nombre: string };
type Run = {
  id: string; fecha: string; estado: string; trigger: string | null; arranco_at: string | null;
  termino_at: string | null; pool_total: number | null; next_pagina: number | null;
  nivel_salida: number | null;
};
// En el plano public_v4 la traza guarda la nota desnormalizada: la proyección pública es
// una foto autocontenida. candidatas_raw es staff-only, así que un cliente no puede
// resolver el título desde ahí -- si faltan estas columnas ve "Nota sin título".
type Trace = {
  candidata_id: string; etapa: string; resultado: string; motivo: string;
  detalle: { recuperable?: boolean } | null; updated_at: string;
  titulo?: string | null; url?: string | null; dominio_norm?: string | null;
};
type Candidate = { id: string; titulo: string | null; url: string | null; dominio_norm: string | null };
type Edit = { accion: string; created_at: string };
type Medio = { fuente_id: string; dominio_norm: string; ok: boolean; outcome: string; http_status: number | null; diagnostico: string | null; articulos: number | null; ms: number | null };
type Keyword = { keyword: string; grupo: string | null; activa: boolean; matches: number };
type Recovery = { candidata_id: string };
type MedioAgrupado = Medio & { fuentes: number; diagnosticos: string[]; outcomes: string[]; estadosHttp: number[] };

const DESCARTES_POR_PAGINA = 100;

// Los outcomes son códigos de la tubería. En la interfaz nunca se muestran solos:
// quien revisa la cobertura necesita saber qué pasó, no leer nombres internos.
function motivoCobertura(medio: MedioAgrupado) {
  const outcomes = new Set(medio.outcomes.map((x) => x.toLowerCase()));
  const http = medio.estadosHttp.find((x) => x >= 400) ?? null;
  if (outcomes.has("missing_transport")) return "Falta definir cómo acceder a este medio; quedó pendiente de configuración.";
  if (outcomes.has("not_collected")) return "El medio estaba listo para consultarse, pero no quedó registrado en este barrido.";
  if (outcomes.has("configured_blocked")) return "Este medio está pausado en la configuración.";
  if (outcomes.has("no_existe") || http === 404) return "La dirección configurada ya no existe (página no encontrada).";
  if (outcomes.has("timeout")) return "El sitio tardó demasiado en responder.";
  if (http === 401 || http === 403) return "El sitio no permitió el acceso automático.";
  if (http === 429) return "El sitio limitó temporalmente los accesos.";
  if (http && http >= 500) return "El sitio respondió con un error propio.";
  if (outcomes.has("empty") || medio.diagnosticos.includes("sin_items")) return "El medio respondió, pero no publicó notas nuevas en esta ventana.";
  if (outcomes.has("budget_skip")) return "Esta corrida no llegó a consultar este medio.";
  return "No se pudo leer el medio por un problema técnico.";
}

// Actividad la lee el equipo editorial: el umbral, el score y el nombre de la
// regla son implementación interna. Traducimos tanto las trazas nuevas como
// las históricas para no exponer números o jerga del modelo en la interfaz.
function motivoEditorial(motivo: string | null | undefined): string {
  const texto = String(motivo ?? "").toLowerCase();
  if (texto.includes("confianza inferior") || texto.includes("confianza_minima")) {
    return "No alcanzó el nivel de relevancia requerido para este clipping.";
  }
  if (texto.includes("repetida") || texto.includes("deduplicacion")) {
    return "Hay otra versión de esta misma noticia; se conserva una sola.";
  }
  if (texto.includes("superó el último filtro")) {
    return "La nota superó la revisión final.";
  }
  return motivo || "No pasó la revisión final.";
}

function hora(iso: string | null) {
  if (!iso) return "todavía en curso";
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
}

function fecha(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function Metric({ label, value, tone = "text-foreground" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

export default async function ActividadV4({ clients, clientId, paginaDescartes, verJuez, permiteJuez = false }: { clients: ClientOpt[]; clientId: string; paginaDescartes: number; verJuez: boolean; /** El detalle del juez es interno (jerga del modelo, motivos crudos): solo staff. */ permiteJuez?: boolean }) {
  const supabase = await createClient();
  // Sólo la proyección pública lleva la nota desnormalizada; los otros planos siguen
  // resolviéndola contra candidatas_raw, que ahí la lee staff.
  const esPublico = planoActivo(supabase) === "public_v4";
  const columnasTraza = "candidata_id, etapa, resultado, motivo, detalle, updated_at"
    + (esPublico ? ", titulo, url, dominio_norm" : "");
  const [{ data: runData, error: runError }, { data: clipData }] = await Promise.all([
    tabla(supabase, "pipeline_runs")
      .select("id, fecha, estado, trigger, arranco_at, termino_at, pool_total, next_pagina, nivel_salida")
      .eq("client_id", clientId)
      .order("arranco_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    tabla(supabase, "clippings")
      .select("id, fecha, estado")
      .eq("client_id", clientId)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const run = (runData ?? null) as Run | null;
  const clip = (clipData ?? null) as { id: string; fecha: string; estado: string } | null;

  const [juezCountRes, entraCountRes, descartaCountRes, ultimoFiltroCountRes, descartadasRes, editRes, mediosRes, keywordsRes, recoveriesRes] = await Promise.all([
    run
      ? tabla(supabase, "candidate_trace")
          .select("*", { count: "exact", head: true })
          .eq("run_id", run.id)
          .eq("etapa", "juez")
      : Promise.resolve({ count: 0 }),
    run
      ? tabla(supabase, "candidate_trace")
          .select("*", { count: "exact", head: true })
          .eq("run_id", run.id)
          .eq("etapa", "juez")
          .eq("resultado", "entra")
      : Promise.resolve({ count: 0 }),
    run
      ? tabla(supabase, "candidate_trace")
          .select("*", { count: "exact", head: true })
          .eq("run_id", run.id)
          .eq("etapa", "juez")
          .eq("resultado", "descarta")
      : Promise.resolve({ count: 0 }),
    run
      ? tabla(supabase, "candidate_trace")
          .select("*", { count: "exact", head: true })
          .eq("run_id", run.id)
          .eq("etapa", "auditor")
          .eq("resultado", "descarta")
      : Promise.resolve({ count: 0 }),
    run
      ? tabla(supabase, "candidate_trace")
          .select(columnasTraza)
          .eq("run_id", run.id)
          .eq("etapa", verJuez ? "juez" : "auditor")
          .eq("resultado", "descarta")
          .order("updated_at", { ascending: false })
          .range((paginaDescartes - 1) * DESCARTES_POR_PAGINA, paginaDescartes * DESCARTES_POR_PAGINA - 1)
      : Promise.resolve({ data: [] as Trace[] }),
    clip
      ? tabla(supabase, "activity")
          .select("accion, created_at")
          .eq("clipping_id", clip.id)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as Edit[] }),
    run
      ? tabla(supabase, "run_medios")
          .select("fuente_id, dominio_norm, ok, outcome, http_status, diagnostico, articulos, ms")
          .eq("run_id", run.id)
          .order("dominio_norm", { ascending: true })
      : Promise.resolve({ data: [] as Medio[] }),
    run
      ? tabla(supabase, "run_keywords")
          .select("keyword, grupo, activa, matches")
          .eq("run_id", run.id)
          .order("matches", { ascending: false })
      : Promise.resolve({ data: [] as Keyword[] }),
    run
      ? tabla(supabase, "recoveries").select("candidata_id").eq("run_id", run.id)
      : Promise.resolve({ data: [] as Recovery[] }),
  ]);
  const juzgadas = juezCountRes.count ?? 0;
  const entran = entraCountRes.count ?? 0;
  const totalJuezDescartadas = descartaCountRes.count ?? 0;
  const totalUltimoFiltro = ultimoFiltroCountRes.count ?? 0;
  const totalDescartadas = verJuez ? totalJuezDescartadas : totalUltimoFiltro;
  const descartadas = (descartadasRes.data ?? []) as Trace[];
  const edits = (editRes.data ?? []) as Edit[];
  const medios = (mediosRes.data ?? []) as Medio[];
  const keywords = (keywordsRes.data ?? []) as Keyword[];
  const recuperadas = new Set(((recoveriesRes.data ?? []) as Recovery[]).map((r) => r.candidata_id));
  // Una fuente puede ser una sección del mismo medio. Conservamos el detalle técnico
  // por fuente en la base, pero lo agrupamos acá para que se lea como un medio.
  const mediosAgrupados = Array.from(medios.reduce((porDominio, medio) => {
    const actual = porDominio.get(medio.dominio_norm);
    if (!actual) {
      porDominio.set(medio.dominio_norm, {
        ...medio,
        fuentes: 1,
        diagnosticos: medio.diagnostico ? [medio.diagnostico] : [],
        outcomes: medio.outcome ? [medio.outcome] : [],
        estadosHttp: medio.http_status ? [medio.http_status] : [],
      });
      return porDominio;
    }
    actual.fuentes += 1;
    actual.ok ||= medio.ok;
    actual.articulos = (actual.articulos ?? 0) + (medio.articulos ?? 0);
    if (medio.diagnostico && !actual.diagnosticos.includes(medio.diagnostico)) actual.diagnosticos.push(medio.diagnostico);
    if (medio.outcome && !actual.outcomes.includes(medio.outcome)) actual.outcomes.push(medio.outcome);
    if (medio.http_status && !actual.estadosHttp.includes(medio.http_status)) actual.estadosHttp.push(medio.http_status);
    return porDominio;
  }, new Map<string, MedioAgrupado>()).values());
  const mediosOk = mediosAgrupados.filter((m) => m.ok);
  const mediosFallidos = mediosAgrupados.filter((m) => !m.ok);
  const keywordsConMatch = keywords.filter((k) => k.matches > 0);
  const ids = [...new Set(descartadas.map((t) => t.candidata_id))];
  const { data: candidateData } = ids.length && !esPublico
    ? await supabase.from("candidatas_raw").select("id, titulo, url, dominio_norm").in("id", ids)
    : { data: [] as Candidate[] };
  const candidateById = new Map(((candidateData ?? []) as Candidate[]).map((c) => [c.id, c]));
  const nombre = clients.find((c) => c.id === clientId)?.nombre ?? "Cliente";
  const progreso = run?.pool_total ? Math.min(100, Math.round((juzgadas / run.pool_total) * 100)) : 0;

  return (
    <div className="w-full p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Actividad</h1>
          <p className="mt-1 text-sm text-muted-foreground">Cómo se armó el clipping de hoy: qué medios se revisaron y qué notas quedaron afuera.</p>
        </div>
        <ActividadFilter clients={clients} value={clientId} />
      </div>

      {runError ? <p className="text-sm text-red-600">No se pudo leer la corrida: {runError.message}</p> : null}
      {!run ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          {nombre}: todavía no hay una corrida registrada.
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Corrida del {fecha(run.fecha)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Arrancó {hora(run.arranco_at)} · {run.termino_at ? `terminó ${hora(run.termino_at)}` : "sigue procesando"}</p>
              </div>
              <span className={"rounded-full px-2.5 py-1 text-xs font-semibold " + (run.estado === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
                {run.estado}
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${progreso}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{juzgadas} de {run.pool_total ?? 0} candidatas pasaron por el juez ({progreso}%).</p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Notas encontradas" value={run.pool_total ?? 0} />
            <Metric label="Juzgadas" value={juzgadas} tone="text-violet-700" />
            <Metric label="Entraron" value={entran} tone="text-emerald-700" />
            <Metric label="Juez descartó" value={totalJuezDescartadas} tone="text-amber-700" />
            <Metric label="Último filtro" value={totalUltimoFiltro} tone="text-orange-700" />
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="text-sm font-semibold text-foreground">Cobertura de medios</h2><p className="mt-1 text-xs text-muted-foreground">Medios y secciones que se intentaron en esta corrida.</p></div>
                <span className="text-sm text-muted-foreground"><b className="text-emerald-700">{mediosOk.length}</b> / {mediosAgrupados.length} con notas</span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div><p className="mb-2 text-xs font-semibold text-emerald-700">Entraron ({mediosOk.length})</p><ul className="max-h-56 space-y-1 overflow-auto pr-1">{mediosOk.map((m) => <li key={m.dominio_norm} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-slate-700">{m.dominio_norm}{m.fuentes > 1 ? ` · ${m.fuentes} fuentes` : ""}</span><span className="shrink-0 text-slate-400">{m.articulos ?? 0} notas</span></li>)}</ul></div>
                <div><p className="mb-2 text-xs font-semibold text-amber-700">No entraron ({mediosFallidos.length})</p><ul className="max-h-56 space-y-1 overflow-auto pr-1">{mediosFallidos.map((m) => <li key={m.dominio_norm} className="text-xs"><p className="truncate text-slate-700">{m.dominio_norm}{m.fuentes > 1 ? ` · ${m.fuentes} fuentes` : ""}</p><p className="text-slate-500">{motivoCobertura(m)}</p></li>)}</ul></div>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-foreground">Palabras clave</h2><p className="mt-1 text-xs text-muted-foreground">Coincidencias sobre las notas de esta corrida.</p></div><span className="text-sm text-muted-foreground"><b className="text-emerald-700">{keywordsConMatch.length}</b> de {keywords.length}</span></div>
              <ul className="mt-4 max-h-64 space-y-1 overflow-auto pr-1">{keywords.map((k) => <li key={k.keyword} className="flex items-center gap-2 text-sm"><span className={"size-2 rounded-full " + (k.matches > 0 ? "bg-emerald-500" : "bg-slate-300")} /><span className="min-w-0 flex-1 truncate text-slate-700">{k.keyword}</span><span className="shrink-0 text-xs text-slate-400">{k.grupo ? `${k.grupo} · ` : ""}{k.matches}</span></li>)}</ul>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <FilterX size={17} className="text-amber-600" />
                <h2 className="text-sm font-semibold text-foreground">{verJuez ? "Descartadas por el juez v4" : "Casi entraron · último filtro"}</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{verJuez ? "Detalle técnico completo del juez. El + las suma directamente al clipping de /hoy de este cliente, sólo en v4 test." : "Sólo las aprobadas por el juez que no llegaron al clipping por el último filtro, igual que “Casi entraron” en v3."}</p>
              {!verJuez ? (permiteJuez ? <Link className="mt-3 inline-block text-xs font-medium text-violet-700 hover:underline" href={`/actividad?cliente=${clientId}&juez=1`}>Ver las {totalJuezDescartadas} descartadas por el juez</Link> : null) : <Link className="mt-3 inline-block text-xs font-medium text-violet-700 hover:underline" href={`/actividad?cliente=${clientId}`}>Volver a “Casi entraron”</Link>}
              {descartadas.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">{verJuez ? "Todavía no hay descartes del juez." : "Ninguna nota aprobada quedó afuera en el último filtro."}</p> : (
                <ul className="mt-4 divide-y divide-border/70">
                  {descartadas.map((t) => {
                    const c = esPublico
                      ? { titulo: t.titulo ?? null, url: t.url ?? null, dominio_norm: t.dominio_norm ?? null }
                      : candidateById.get(t.candidata_id);
                    const recuperable = verJuez || t.detalle?.recuperable === true;
                    return <li key={t.candidata_id} className="flex gap-2 py-3 first:pt-0">
                      {recuperable ? <RecuperarV4Button runId={run.id} candidataId={t.candidata_id} recuperada={recuperadas.has(t.candidata_id)} /> : <span className="inline-flex size-7 shrink-0 items-center justify-center text-slate-300" title="No se recupera: ya hay una versión de esta nota">—</span>}
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-foreground">{c?.titulo ?? "Nota sin título"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{c?.dominio_norm ?? "medio sin identificar"}</p>
                      <p className="mt-1 text-sm text-slate-600">{motivoEditorial(t.motivo)}</p>
                      {c?.url ? <a className="mt-1 inline-block text-xs font-medium text-violet-700 hover:underline" href={c.url} target="_blank" rel="noreferrer">Abrir nota</a> : null}
                      </div></li>;
                  })}
                </ul>
              )}
              {totalDescartadas > DESCARTES_POR_PAGINA ? <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                <span>Página {paginaDescartes} de {Math.ceil(totalDescartadas / DESCARTES_POR_PAGINA)} · {totalDescartadas} descartadas</span>
                <div className="flex gap-2">
                  {paginaDescartes > 1 ? <Link className="rounded border border-border px-2 py-1 hover:border-violet-500 hover:text-violet-700" href={`/actividad?cliente=${clientId}&descartes=${paginaDescartes - 1}${verJuez ? "&juez=1" : ""}`}>Anterior</Link> : null}
                  {paginaDescartes < Math.ceil(totalDescartadas / DESCARTES_POR_PAGINA) ? <Link className="rounded border border-border px-2 py-1 hover:border-violet-500 hover:text-violet-700" href={`/actividad?cliente=${clientId}&descartes=${paginaDescartes + 1}${verJuez ? "&juez=1" : ""}`}>Siguiente</Link> : null}
                </div>
              </div> : null}
            </div>

            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2"><Layers3 size={17} className="text-violet-700" /><h2 className="text-sm font-semibold">Clipping guardado</h2></div>
                <p className="mt-3 text-sm text-foreground">{clip ? `${fecha(clip.fecha)} · ${clip.estado}` : "Todavía no se guardó el clipping."}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2"><FilePenLine size={17} className="text-slate-600" /><h2 className="text-sm font-semibold">Ediciones</h2></div>
                {edits.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Todavía no hubo ediciones en este clipping.</p> : <ul className="mt-3 space-y-2">{edits.map((e, i) => <li key={`${e.created_at}-${i}`} className="flex items-center gap-2 text-sm text-slate-700"><Clock3 size={13} className="text-muted-foreground" />{e.accion} · {hora(e.created_at)}</li>)}</ul>}
              </div>
              {/* Nota de alcance: jerga interna (planos, v4/v3). Sólo staff. */}
              {permiteJuez ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                  <div className="flex items-center gap-2 font-semibold text-slate-700"><PlayCircle size={14} /> Alcance de esta vista</div>
                  <p className="mt-1">Cobertura, keywords, juez y recuperaciones son datos propios de v4 test. No se leyó ni se escribió el clipping de producción.</p>
                </div>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
