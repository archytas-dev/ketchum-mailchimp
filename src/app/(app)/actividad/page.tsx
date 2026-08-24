import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import { ordenarClientesActivos } from "@/lib/clientes";
import { Radio, KeyRound, Undo2, ClipboardList, Cpu, HeartPulse, CheckCircle2, AlertTriangle, ShieldAlert, ExternalLink } from "lucide-react";
import ActividadFilter from "./ActividadFilter";
import CopyLinkButton from "./CopyLinkButton";
import RecuperarButton from "./RecuperarButton";
import StaffOnlySection from "@/components/StaffOnlySection";

export const dynamic = "force-dynamic";


type MedioDetalle = {
  dominio: string;
  ok: boolean;
  outcome?: string | null;
  ms?: number | null;
  articulos?: number | null;
};

const MEDIO_OUTCOME_LABEL: Record<string, string> = {
  timeout: "no respondió a tiempo",
  empty: "respondió pero sin notas",
  budget_skip: "no llegamos a intentarlo",
  exception: "error técnico",
};
type KeywordDetalle = { keyword: string; grupo: string | null; activa: boolean; matches: number };

type ResumenRow = {
  fecha: string;
  medios_intentados: number | null;
  medios_ok: number | null;
  medios_sin_resultado: number | null;
  notas_fetched: number | null;
  notas_post_dedup: number | null;
  notas_post_ia: number | null;
  notas_enviadas: number | null;
  keywords_totales: number | null;
  keywords_con_match: number | null;
  keywords_detalle: KeywordDetalle[] | null;
  medios_detalle: MedioDetalle[] | null;
};

type BloqueadoRow = {
  dominio: string;
  motivo: string | null;
  http_status: number | null;
  intentos: number;
};

type DescartadaRow = {
  id: string;
  titulo: string;
  url: string | null;
  medio: string | null;
  fase: string;
  motivo: string;
  score: number | null;
  recuperada?: boolean;
  created_at?: string;
};

const MOTIVO_LABEL: Record<string, string> = {
  no_aprobado_por_ia: "la IA no la aprobó",
  filtro_deterministico_quality_guard: "filtro de calidad post-IA",
};

const FASE_LABEL: Record<string, string> = { ai_filter: "Filtro IA", post_ai: "Post-IA" };

type ChangelogRow = {
  id: string;
  tabla: string;
  accion: "alta" | "edicion" | "baja";
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  created_at: string;
};

const TABLA_LABEL: Record<string, string> = {
  medios: "medio",
  kw_keywords: "palabra clave",
  gacetillas: "gacetilla",
  tiers: "tier",
  notes_precarga: "nota precargada",
};

const ACCION_CHANGELOG_LABEL: Record<string, string> = { alta: "agregó", edicion: "editó", baja: "eliminó" };

type TelemetriaRow = {
  fecha: string;
  n8n_run_id: string | null;
  trigger_tipo: string | null;
  ia_chunks_total: number | null;
  ia_chunks_error: number | null;
  costo_openai_usd: number | null;
  duracion_ms: number | null;
};

function displayValue(row: ChangelogRow): string {
  const d = (row.despues ?? row.antes ?? {}) as Record<string, unknown>;
  return String(d.nombre ?? d.dominio ?? d.keyword ?? d.titulo ?? "(sin nombre)");
}

function relTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function chip(iso: string): string {
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
}

// Un paso del embudo, con el % de caida respecto del anterior (no respecto del total --
// eso es lo que de verdad importa para saber en que etapa se pierde volumen).
function Paso({
  label,
  valor,
  anterior,
  esUltimo,
}: {
  label: string;
  valor: number;
  anterior: number | null;
  esUltimo?: boolean;
}) {
  const caida = anterior && anterior > 0 ? Math.round((1 - valor / anterior) * 100) : null;
  return (
    <div className="flex items-center gap-3">
      <div className={"flex-1 rounded-lg border border-border p-3 " + (esUltimo ? "bg-brand/5" : "bg-muted")}>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold text-foreground">{valor}</p>
      </div>
      {caida !== null && (
        <span className="text-xs text-muted-foreground w-16 text-center shrink-0">
          {caida > 0 ? `−${caida}%` : "="}
        </span>
      )}
    </div>
  );
}

export default async function ActividadPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { effective } = await getEffectiveRole(supabase);
  const isStaff = isStaffRole(effective);

  // [19/08] Cutover: solo la herramienta real (no-legado) -- la telemetría/actividad vieja
  // (v1/v2) ya no se consulta desde acá.
  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  const clients = ordenarClientesActivos((clientRows ?? []) as { id: string; slug: string; nombre: string }[]);

  const clientId = sp.cliente && clients.some((c) => c.id === sp.cliente) ? sp.cliente : clients[0]?.id;

  if (!clientId) {
    return (
      <div className="w-full p-6">
        <h1 className="text-xl font-semibold mb-1">Actividad</h1>
        <p className="text-sm text-muted-foreground">No hay clientes disponibles.</p>
      </div>
    );
  }

  // RPC en vez de leer run_stats directo: la tabla es 100% staff-only por RLS (decisión
  // 05/08), get_actividad_resumen es la puerta sancionada que expone solo lo agregado
  // (cobertura + embudo) -- nunca costo_openai_usd/ia_chunks_error/duracion_ms, eso
  // sigue siendo "telemetría cruda" solo para dev/pm (TDD §8.3).
  const [
    { data: resumenData, error: resumenError },
    { data: bloqueadosData },
    { data: descartadasData },
    changelogRes,
    descartadasCompletasRes,
    telemetriaRes,
  ] = await Promise.all([
    supabase.rpc("get_actividad_resumen", { p_client_id: clientId, p_dias: 14 }),
    supabase
      .from("medios_bloqueados")
      .select("dominio, motivo, http_status, intentos")
      .eq("client_id", clientId)
      .eq("resuelto", false)
      .order("ultima_vez", { ascending: false })
      .limit(20),
    // "Casi entraron" (TDD §8.3): versión curada para CUALQUIER rol (cliente incluido).
    // Solo lo que todavía no se recuperó -- si ya se agregó al clipping, no tiene sentido
    // ofrecerla de nuevo. Ojo: `score` hoy siempre llega null (pendiente instrumentar en
    // n8n), así que ordenamos por más reciente, no por relevancia real.
    supabase
      .from("notas_descartadas")
      .select("id, titulo, url, medio, fase, motivo, score")
      .eq("client_id", clientId)
      .eq("recuperada", false)
      .order("created_at", { ascending: false })
      .limit(15),
    // config_changelog es staff-only por RLS (el cliente no necesita ver el auditlog de
    // sus propios cambios) -- por eso solo se pide si isStaff, ni siquiera intentamos la
    // query para cliente (RLS la bloquearía igual, pero no tiene sentido pedirla).
    isStaff
      ? supabase
          .from("config_changelog")
          .select("id, tabla, accion, antes, despues, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: null as ChangelogRow[] | null }),
    // "Descartadas completas" (TDD §8.3): dev/pm ven TODAS, recuperadas o no, con fase
    // cruda + score -- el cliente solo ve la versión curada de arriba.
    isStaff
      ? supabase
          .from("notas_descartadas")
          .select("id, titulo, url, medio, fase, motivo, score, recuperada, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: null as DescartadaRow[] | null }),
    // Telemetría cruda (TDD §8.3/§9): run_stats es 100% staff-only por RLS, así que dev/pm
    // pueden leerla directo -- sin pasar por la RPC de arriba, que a propósito la excluye
    // para el cliente. Últimas 5 corridas, para ver si el costo/errores de IA vienen subiendo.
    isStaff
      ? supabase
          .from("run_stats")
          .select("fecha, n8n_run_id, trigger_tipo, ia_chunks_total, ia_chunks_error, costo_openai_usd, duracion_ms")
          .eq("client_id", clientId)
          .order("fecha", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: null as TelemetriaRow[] | null }),
  ]);

  const resumen = (resumenData ?? []) as ResumenRow[];
  const ultimo = resumen[0] ?? null;
  const bloqueados = (bloqueadosData ?? []) as BloqueadoRow[];
  const descartadas = (descartadasData ?? []) as DescartadaRow[];
  const changelog = (changelogRes.data ?? []) as ChangelogRow[];
  const descartadasCompletas = (descartadasCompletasRes.data ?? []) as DescartadaRow[];
  const telemetria = (telemetriaRes.data ?? []) as TelemetriaRow[];

  // Health check (TDD §8.3, "Checklist pre-demo del Doc Funcional §4.6"): 4 señales rápidas
  // para saber si hay algo roto sin tener que ir tabla por tabla. Solo cuenta filas -- consultas
  // chicas, no vale la pena meterlas en la RPC de arriba.
  let health: {
    tiersCount: number;
    gacetillasVigentes: number;
    mediosManualReview: number;
  } | null = null;
  if (isStaff) {
    const [tiersRes, gacetillasRes, manualReviewRes] = await Promise.all([
      supabase.from("tiers").select("*", { count: "exact", head: true }).eq("client_id", clientId),
      supabase
        .from("gacetillas")
        .select("*", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("estado", "BUSCANDO"),
      supabase
        .from("medios")
        .select("*", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("metodo", "manual_review")
        .eq("activo", true),
    ]);
    health = {
      tiersCount: tiersRes.count ?? 0,
      gacetillasVigentes: gacetillasRes.count ?? 0,
      mediosManualReview: manualReviewRes.count ?? 0,
    };
  }

  const ultimaCorridaOk = (() => {
    if (!ultimo) return null;
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const reciente = ultimo.fecha === hoy || ultimo.fecha === ayer;
    const t0 = telemetria[0];
    const errorRatio = t0?.ia_chunks_total ? (t0.ia_chunks_error ?? 0) / t0.ia_chunks_total : 0;
    return reciente && errorRatio < 0.2;
  })();

  return (
    // Ancho completo, mismo criterio que Base de Datos: con max-w quedaba angosto mientras
    // sobraba viewport a los costados.
    <div className="w-full p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Actividad</h1>
          <p className="text-sm text-muted-foreground">Cobertura y volumen de la última corrida.</p>
        </div>
        <ActividadFilter clients={clients} value={clientId} />
      </div>

      {resumenError && (
        <p className="text-sm text-red-600">No se pudo cargar la actividad: {resumenError.message}</p>
      )}

      {/* Casi entraron y Medios que nos rebotaron van PRIMERO (pedido de Fedra, 11/08): es lo
          accionable del día. Ninguna de las dos depende de que exista una fila en run_stats
          -- leen notas_descartadas y medios_bloqueados. */}

      {/* Casi entraron */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
          <Undo2 size={15} className="text-muted-foreground" /> Casi entraron
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Notas que se descartaron durante el filtrado. Si alguna te parece que debería haber
          entrado, agregala directo al clipping de hoy (aparece en Principal) o abrila para
          chequearla.
        </p>
        {descartadas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin descartes pendientes.</p>
        ) : (
          <ul className="space-y-2">
            {descartadas.map((d) => (
              <li key={d.id} className="flex items-start gap-2 text-sm">
                <RecuperarButton descartadaId={d.id} clientId={clientId} />
                {d.url ? <CopyLinkButton url={d.url} /> : <span className="w-7 shrink-0" />}
                <div className="flex-1 min-w-0">
                  {d.url ? (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-1 text-foreground/90 underline-offset-4 hover:text-foreground hover:underline"
                    >
                      <span className="truncate">{d.titulo}</span>
                      <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                    </a>
                  ) : (
                    <p className="text-foreground/90 truncate">{d.titulo}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {d.medio ?? "medio desconocido"} · {MOTIVO_LABEL[d.motivo] ?? d.motivo}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Medios que nos rebotaron (pedido de Fedra, 11/08) */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
          <ShieldAlert size={15} className="text-muted-foreground" /> Medios que nos rebotaron
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Medios que nos rechazaron el acceso (nos detectan como bot o piden suscripción), así
          que sus notas nunca llegaron a evaluarse. Abrí el medio para chequear si hoy publicó
          algo que debería haber entrado.
        </p>
        {bloqueados.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ningún medio nos rebotó en las corridas registradas.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {bloqueados.map((b) => (
              <li key={b.dominio} className="flex items-center gap-2 text-sm">
                <ShieldAlert size={13} className="text-amber-600 shrink-0" />
                <a
                  href={/^https?:\/\//i.test(b.dominio) ? b.dominio : `https://${b.dominio}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex min-w-0 flex-1 items-center gap-1 text-foreground/90 underline-offset-4 hover:text-foreground hover:underline"
                >
                  <span className="truncate">{b.dominio}</span>
                  <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                </a>
                <span className="text-xs text-muted-foreground shrink-0">
                  {b.motivo ?? (b.http_status ? `HTTP ${b.http_status}` : "sin motivo")} · {b.intentos}{" "}
                  {b.intentos === 1 ? "intento" : "intentos"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!resumenError && !ultimo && (
        <p className="text-sm text-muted-foreground">
          Todavía no hay corridas registradas para este cliente en los últimos 14 días.
        </p>
      )}

      {ultimo && (
        <>
          <p className="text-xs text-muted-foreground">Última corrida: {chip(ultimo.fecha)}</p>

          {/* Cobertura */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
              <Radio size={15} className="text-muted-foreground" /> Cobertura de medios
            </h2>
            <p className="text-sm text-foreground/90 mb-3">
              De <span className="font-semibold">{ultimo.medios_intentados ?? 0}</span> medios monitoreados,
              entramos a <span className="font-semibold">{ultimo.medios_ok ?? 0}</span>
              {ultimo.medios_sin_resultado ? (
                <> — <span className="font-semibold text-brand-warm">{ultimo.medios_sin_resultado}</span> sin resultado.</>
              ) : (
                "."
              )}
            </p>
            {ultimo.medios_detalle && ultimo.medios_detalle.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Entraron ({ultimo.medios_detalle.filter((m) => m.ok).length})
                  </p>
                  <ul className="space-y-1">
                    {ultimo.medios_detalle
                      .filter((m) => m.ok)
                      .map((m) => (
                        <li key={m.dominio} className="flex items-center gap-1.5 text-xs">
                          <CheckCircle2 size={12} className="text-green-600 shrink-0" />
                          <span className="text-foreground/80 truncate">{m.dominio}</span>
                        </li>
                      ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Sin resultado ({ultimo.medios_detalle.filter((m) => !m.ok).length})
                  </p>
                  <ul className="space-y-1">
                    {ultimo.medios_detalle
                      .filter((m) => !m.ok)
                      .map((m) => (
                        <li key={m.dominio} className="flex items-center gap-1.5 text-xs">
                          <AlertTriangle size={12} className="text-amber-600 shrink-0" />
                          <span className="text-foreground/80 truncate">{m.dominio}</span>
                          {m.outcome && MEDIO_OUTCOME_LABEL[m.outcome] && (
                            <span className="text-muted-foreground shrink-0">
                              · {MEDIO_OUTCOME_LABEL[m.outcome]}
                            </span>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mb-3">
                Esta corrida es de antes de instrumentar el detalle por medio — solo quedó el
                conteo agregado de arriba.
              </p>
            )}
          </div>

          {/* Embudo */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h2 className="text-sm font-medium text-foreground mb-3">Embudo de notas</h2>
            <div className="space-y-2">
              <Paso label="Traídas" valor={ultimo.notas_fetched ?? 0} anterior={null} />
              <Paso
                label="Después de deduplicar"
                valor={ultimo.notas_post_dedup ?? 0}
                anterior={ultimo.notas_fetched}
              />
              <Paso
                label="Después del filtro IA"
                valor={ultimo.notas_post_ia ?? 0}
                anterior={ultimo.notas_post_dedup}
              />
              <Paso
                label="Enviadas"
                valor={ultimo.notas_enviadas ?? 0}
                anterior={ultimo.notas_post_ia}
                esUltimo
              />
            </div>
          </div>

          {/* Keywords */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
              <KeyRound size={15} className="text-muted-foreground" /> Palabras clave
            </h2>
            <p className="text-sm text-foreground/90 mb-3">
              <span className="font-semibold">{ultimo.keywords_con_match ?? 0}</span> de{" "}
              <span className="font-semibold">{ultimo.keywords_totales ?? 0}</span> palabras clave
              encontraron algo hoy.
            </p>
            {ultimo.keywords_detalle && ultimo.keywords_detalle.length > 0 ? (
              <ul className="space-y-1">
                {[...ultimo.keywords_detalle]
                  .sort((a, b) => b.matches - a.matches)
                  .map((k) => (
                    <li key={k.keyword} className="flex items-center gap-2 text-sm">
                      {k.matches > 0 ? (
                        <CheckCircle2 size={13} className="text-green-600 shrink-0" />
                      ) : (
                        <span className="w-[13px] h-[13px] shrink-0 rounded-full border border-muted-foreground/40" />
                      )}
                      <span className={"flex-1 truncate " + (k.matches > 0 ? "text-foreground/90" : "text-muted-foreground")}>
                        {k.keyword}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {k.grupo ? `${k.grupo} · ` : ""}
                        {k.matches} {k.matches === 1 ? "nota" : "notas"}
                        {!k.activa ? " · inactiva" : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Esta corrida es de antes de instrumentar el detalle por keyword — solo quedó el
                conteo agregado de arriba.
              </p>
            )}
          </div>
        </>
      )}

      {/* Cambios del cliente y Health check tampoco dependen de run_stats: leen
          config_changelog y conteos de otras tablas. */}

          {/* Descartadas completas (staff-only, TDD §8.3) */}
          {isStaff && (
            <StaffOnlySection label="Solo staff — el cliente ve la versión curada de arriba">
              <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
                <Undo2 size={15} className="text-muted-foreground" /> Descartadas completas
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Todas, recuperadas o no, con fase técnica y score. El cliente solo ve el resumen
                curado de "Casi entraron" de arriba.
              </p>
              {descartadasCompletas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin descartes registrados.</p>
              ) : (
                <ul className="space-y-1.5">
                  {descartadasCompletas.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-sm">
                      <span
                        className={
                          "text-foreground/90 flex-1 truncate " + (d.recuperada ? "line-through opacity-50" : "")
                        }
                      >
                        {d.titulo}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {FASE_LABEL[d.fase] ?? d.fase} · {d.motivo}
                        {d.score != null ? ` · score ${d.score}` : ""}
                        {d.recuperada ? " · recuperada" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </StaffOnlySection>
          )}

          {/* Health Check (staff-only, TDD §8.3) */}
          {isStaff && health && (
            <StaffOnlySection label="Solo staff — el cliente nunca ve esto">
              <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                <HeartPulse size={15} className="text-muted-foreground" /> Health check
              </h2>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  {ultimaCorridaOk ? (
                    <CheckCircle2 size={15} className="text-green-600 shrink-0" />
                  ) : (
                    <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                  )}
                  <span className="text-foreground/90">
                    Última corrida: {ultimo ? chip(ultimo.fecha) : "sin datos"}
                    {ultimaCorridaOk === false && " — revisar (vieja o con muchos errores de IA)"}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  {health.tiersCount > 0 ? (
                    <CheckCircle2 size={15} className="text-green-600 shrink-0" />
                  ) : (
                    <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                  )}
                  <span className="text-foreground/90">
                    Tiers cargados: {health.tiersCount}
                    {health.tiersCount === 0 && " — vacío, el ad_value no va a llegar a las notas"}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-muted-foreground shrink-0" />
                  <span className="text-foreground/90">Gacetillas vigentes: {health.gacetillasVigentes}</span>
                </li>
                <li className="flex items-center gap-2">
                  {health.mediosManualReview === 0 ? (
                    <CheckCircle2 size={15} className="text-green-600 shrink-0" />
                  ) : (
                    <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                  )}
                  <span className="text-foreground/90">
                    Medios en revisión manual: {health.mediosManualReview}
                    {health.mediosManualReview > 0 && " — asignarles dominio en Base de Datos"}
                  </span>
                </li>
              </ul>
            </StaffOnlySection>
          )}

          {/* Telemetría cruda (staff-only, TDD §8.3) */}
          {isStaff && (
            <StaffOnlySection label="Solo staff — el cliente nunca ve esto">
              <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
                <Cpu size={15} className="text-muted-foreground" /> Telemetría cruda
              </h2>
              <p className="text-xs text-muted-foreground mb-3">Últimas 5 corridas.</p>
              {telemetria.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin corridas registradas.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-1.5 pr-3 font-medium">Fecha</th>
                        <th className="py-1.5 pr-3 font-medium">Trigger</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Chunks IA</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Con error</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Costo IA</th>
                        <th className="py-1.5 font-medium text-right">Duración</th>
                      </tr>
                    </thead>
                    <tbody>
                      {telemetria.map((t) => {
                        const errorRatio =
                          t.ia_chunks_total && t.ia_chunks_total > 0
                            ? (t.ia_chunks_error ?? 0) / t.ia_chunks_total
                            : 0;
                        return (
                          <tr key={t.n8n_run_id ?? t.fecha} className="border-b border-border/60 last:border-0">
                            <td className="py-1.5 pr-3 text-foreground/90">{chip(t.fecha)}</td>
                            <td className="py-1.5 pr-3 text-muted-foreground">{t.trigger_tipo ?? "—"}</td>
                            <td className="py-1.5 pr-3 text-right text-foreground/90">{t.ia_chunks_total ?? 0}</td>
                            <td
                              className={
                                "py-1.5 pr-3 text-right font-medium " +
                                (errorRatio > 0.2 ? "text-red-600" : "text-foreground/90")
                              }
                            >
                              {t.ia_chunks_error ?? 0}
                              {errorRatio > 0.2 ? ` (${Math.round(errorRatio * 100)}%)` : ""}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-foreground/90">
                              {t.costo_openai_usd != null ? `$${t.costo_openai_usd.toFixed(4)}` : "—"}
                            </td>
                            <td className="py-1.5 text-right text-foreground/90">
                              {t.duracion_ms != null ? `${Math.round(t.duracion_ms / 1000)}s` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </StaffOnlySection>
          )}

          {/* Cambios de Fedra (staff-only, TDD §8.2 "Config que tocó") */}
          {isStaff && (
            <StaffOnlySection label="Solo staff — el cliente nunca ve esto">
              <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
                <ClipboardList size={15} className="text-muted-foreground" /> Cambios del cliente
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Se manda además como resumen diario a Slack (16hs).
              </p>
              {changelog.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin cambios registrados.</p>
              ) : (
                <ul className="space-y-1.5">
                  {changelog.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <span className="text-foreground/90 flex-1 truncate">
                        {ACCION_CHANGELOG_LABEL[c.accion]} {TABLA_LABEL[c.tabla] ?? c.tabla}{" "}
                        <span className="font-medium">{displayValue(c)}</span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">{relTime(c.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </StaffOnlySection>
          )}
    </div>
  );
}
