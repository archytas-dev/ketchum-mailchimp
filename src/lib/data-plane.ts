import "server-only";

/**
 * Unico punto donde la app decide si una pantalla lee/escribe el plano v3 (public) o el
 * plano aislado v4 (test). El navegador no recibe esta decision.
 *
 * La resolucion normal es por usuario autenticado: test@archytas.io usa v4/test y todos
 * los demas usuarios, incluida Fedra, usan v3/public. La variable KETCHUM_DATA_PLANE queda
 * solamente como fallback para procesos internos que no pasan por createClient().
 */

export type Plano = "v3" | "test_v4" | "public_v4";

/** Nombres logicos que usan las pantallas. Nunca el nombre fisico de la tabla. */
export type TablaLogica =
  | "clippings"
  | "notes"
  | "activity"
  | "exports"
  | "summaries"
  | "user_clipping_state"
  | "notes_precarga"
  | "reportes"
  | "pipeline_runs"
  | "candidate_trace"
  | "run_medios"
  | "run_keywords"
  | "recoveries";

type Destino = { schema: string | null; tabla: string };

/**
 * El mapa. schema null significa el schema por defecto de PostgREST (public).
 * clients, profiles, user_client_access, medios, tiers, kw_keywords, secciones y
 * google_alerts son compartidas y se leen desde ambos planos.
 */
const MAPA_BASE: Record<TablaLogica, Record<Exclude<Plano, "public_v4">, Destino>> = {
  clippings:           { v3: { schema: null, tabla: "clippings" },           test_v4: { schema: "test", tabla: "clippings_v4" } },
  notes:               { v3: { schema: null, tabla: "notes" },               test_v4: { schema: "test", tabla: "notes_v4" } },
  activity:            { v3: { schema: null, tabla: "activity" },            test_v4: { schema: "test", tabla: "activity_v4" } },
  exports:             { v3: { schema: null, tabla: "exports" },             test_v4: { schema: "test", tabla: "exports_v4" } },
  summaries:           { v3: { schema: null, tabla: "summaries" },           test_v4: { schema: "test", tabla: "summaries_v4" } },
  user_clipping_state: { v3: { schema: null, tabla: "user_clipping_state" }, test_v4: { schema: "test", tabla: "user_clipping_state_v4" } },
  notes_precarga:      { v3: { schema: null, tabla: "notes_precarga" },      test_v4: { schema: "test", tabla: "notes_precarga_v4" } },
  reportes:            { v3: { schema: null, tabla: "reportes" },            test_v4: { schema: "test", tabla: "reportes_v4" } },
  pipeline_runs:       { v3: { schema: null, tabla: "pipeline_runs" },       test_v4: { schema: "test", tabla: "v4_pipeline_runs" } },
  candidate_trace:     { v3: { schema: null, tabla: "v4_candidatas_traza" }, test_v4: { schema: "test", tabla: "v4_candidatas_traza" } },
  run_medios:          { v3: { schema: null, tabla: "run_stats" },           test_v4: { schema: "test", tabla: "v4_run_medios" } },
  run_keywords:        { v3: { schema: null, tabla: "run_stats" },           test_v4: { schema: "test", tabla: "v4_run_keywords" } },
  recoveries:          { v3: { schema: null, tabla: "notas_descartadas" },   test_v4: { schema: "test", tabla: "v4_recuperaciones" } },
};

// `public_v4` mantiene el contrato de nombres de v4, pero en el schema public.
// No hay un camino que reutilice por accidente las tablas legacy sin sufijo.
const MAPA = Object.fromEntries(
  Object.entries(MAPA_BASE).map(([logica, destinos]) => [
    logica,
    { ...destinos, public_v4: { schema: null, tabla: destinos.test_v4.tabla } },
  ]),
) as Record<TablaLogica, Record<Plano, Destino>>;

// La actividad publica es una foto aislada tomada al guardar el clipping. No
// reutiliza la traza legacy homonima ni el schema interno test.
MAPA.pipeline_runs.public_v4 = { schema: null, tabla: "v4_pipeline_runs_public" };
MAPA.candidate_trace.public_v4 = { schema: null, tabla: "v4_candidatas_traza_public" };
MAPA.run_medios.public_v4 = { schema: null, tabla: "v4_run_medios_public" };
MAPA.run_keywords.public_v4 = { schema: null, tabla: "v4_run_keywords_public" };
MAPA.recoveries.public_v4 = { schema: null, tabla: "v4_recuperaciones_public" };

type Entorno = "production" | "preview" | "development";

// UUID estable de auth.users. No usamos el email para decidir el plano.
export const USUARIO_TEST_V4_ID = "b005c199-9e42-42e7-a2e0-ebdea7dacd34";

// El registro vive sólo en memoria del servidor y queda asociado al cliente Supabase de la
// request. No hay un selector de schema controlable desde el navegador.
const PLANES_POR_CLIENTE = new WeakMap<object, Plano>();

type UsuarioPlano = {
  id?: string | null;
  // app_metadata lo asigna un administrador; user_metadata queda excluido porque
  // el propio usuario puede modificarlo desde el navegador.
  app_metadata?: Record<string, unknown> | null;
};

export function planoParaUsuario(user?: UsuarioPlano | null): Plano {
  if (user?.id === USUARIO_TEST_V4_ID) return "test_v4";
  return user?.app_metadata?.ketchum_data_plane === "public_v4" ? "public_v4" : "v3";
}

export function registrarPlano(cliente: object, user?: UsuarioPlano | null): void {
  PLANES_POR_CLIENTE.set(cliente, planoParaUsuario(user));
}

function entorno(): Entorno {
  const v = process.env.VERCEL_ENV;
  if (v === "production" || v === "preview") return v;
  return "development";
}

/**
 * Resuelve el plano activo. Una request autenticada siempre usa el plano registrado para
 * su usuario. El fallback por variable se conserva para tareas internas sin usuario; en
 * produccion, una variable test se fuerza a v3 para no habilitar v4 accidentalmente.
 */
export function planoActivo(cliente?: object): Plano {
  const registrado = cliente ? PLANES_POR_CLIENTE.get(cliente) : undefined;
  if (registrado) return registrado;

  const pedido = (process.env.KETCHUM_DATA_PLANE ?? "").trim().toLowerCase();
  const env = entorno();

  if (pedido === "" || pedido === "v3") return "v3";

  if (pedido !== "test") {
    console.error(
      `[data-plane] KETCHUM_DATA_PLANE="${pedido}" no es valido. ` +
        `Valores admitidos: "v3" | "test". Se usa "v3".`,
    );
    return "v3";
  }

  if (env === "production") {
    console.error(
      "[data-plane] KETCHUM_DATA_PLANE=test en produccion. Se usa v3 en el fallback; " +
        "el usuario de prueba se habilita solamente por su UUID autenticado.",
    );
    return "v3";
  }

  return "test_v4";
}

export function enPlanoV4(cliente?: object): boolean {
  return planoActivo(cliente) !== "v3";
}

/** La configuracion compartida queda de solo lectura para el usuario v4. */
export function configEsSoloLectura(cliente?: object): boolean {
  return enPlanoV4(cliente);
}

/**
 * Guarda del lado servidor para acciones que escribirian configuracion compartida o datos
 * exclusivos de v3. Deshabilitar un boton no alcanza: una Server Action se puede invocar
 * sin pasar por la interfaz.
 */
export function rechazoEscrituraCompartida(cliente?: object): { ok: false; error: string } | null {
  if (!enPlanoV4(cliente)) return null;
  return {
    ok: false,
    error: "Esta accion esta bloqueada en la vista de prueba v4: modificaria datos compartidos de la v3.",
  };
}

/**
 * El alta de Precarga (`addPrecarga`) llama a una RPC que hoy solo sabe escribir en el schema
 * `test` (`v4_test_preload_notes`). En `public_v4` eso escribiria notas en `test.notes_precarga_v4`
 * en vez de `public.notes_precarga_v4` -- un cruce silencioso entre planos. Hasta que exista una
 * RPC propia de `public_v4`, Precarga queda de solo lectura ahi. `test_v4` no se toca: su RPC
 * ya escribe donde corresponde.
 */
export function precargaSoloLecturaPublicV4(cliente?: object): boolean {
  return planoActivo(cliente) === "public_v4";
}

export function destino(tabla: TablaLogica, cliente?: object): Destino {
  return MAPA[tabla][planoActivo(cliente)];
}

export function etiquetaPlano(cliente?: object): string | null {
  const plano = planoActivo(cliente);
  if (plano === "test_v4") return "Plano de prueba v4 (test)";
  if (plano === "public_v4") return "Plano operativo v4";
  return null;
}

/**
 * Acceso a tablas por nombre logico. El cliente es generico a proposito: este modulo no
 * tiene que importar el tipo concreto de Supabase ni forzar a las pantallas a usarlo.
 */
export function tabla<
  C extends {
    from: (t: string) => unknown;
    schema: (s: string) => { from: (t: string) => unknown };
  },
>(cliente: C, logica: TablaLogica) {
  const d = destino(logica, cliente);
  return d.schema === null
    ? (cliente.from(d.tabla) as ReturnType<C["from"]>)
    : (cliente.schema(d.schema).from(d.tabla) as ReturnType<C["from"]>);
}
