import "server-only";

/**
 * [W0.19] Plano de datos — el ÚNICO punto donde se decide si una pantalla lee la v3
 * (`public.notes`, `public.clippings`, …) o el plano v4 aislado (`test.notes_v4`, …).
 *
 * Runbook: docs/pipeline-v4/roadmap-webapp-v4.md §3.6, Paso 5.
 *
 * LA REGLA QUE ESTE MÓDULO EXISTE PARA SOSTENER
 * Ninguna pantalla elige tabla con un `if` suelto. Si mañana hay que cambiar el destino, se
 * cambia acá y en ningún otro lado. El runbook lo dice como condición de "no seguir":
 * *"queda un `.from('notes')` en una pantalla habilitada para modo test"* → está mal hecho.
 *
 * POR QUÉ `server-only`
 * La decisión no puede viajar al navegador. `KETCHUM_DATA_PLANE` no lleva el prefijo
 * `NEXT_PUBLIC_` justamente para que Next no la inline en el bundle (guía de Next 16,
 * "environment-variables": las variables sin ese prefijo sólo existen en Node). El
 * `import "server-only"` hace que importar este módulo desde un Client Component sea un error
 * de compilación, no un bug silencioso.
 */

export type Plano = "v3" | "test_v4";

/** Nombres lógicos que usan las pantallas. Nunca el nombre físico de la tabla. */
export type TablaLogica =
  | "clippings"
  | "notes"
  | "activity"
  | "exports"
  | "summaries"
  | "user_clipping_state"
  | "notes_precarga"
  | "reportes";

type Destino = { schema: string | null; tabla: string };

/**
 * El mapa. `schema: null` = el schema por defecto de PostgREST (`public`), que es como
 * supabase-js consulta si no se le dice otra cosa.
 *
 * Lo que NO está acá es deliberado: `clients`, `profiles`, `user_client_access`, `medios`,
 * `tiers`, `kw_keywords`, `secciones` y `google_alerts` son compartidas y de sólo lectura en
 * los dos planos (§3.3 del roadmap). No tienen espejo y no deben tenerlo.
 */
const MAPA: Record<TablaLogica, Record<Plano, Destino>> = {
  clippings:           { v3: { schema: null, tabla: "clippings" },           test_v4: { schema: "test", tabla: "clippings_v4" } },
  notes:               { v3: { schema: null, tabla: "notes" },               test_v4: { schema: "test", tabla: "notes_v4" } },
  activity:            { v3: { schema: null, tabla: "activity" },            test_v4: { schema: "test", tabla: "activity_v4" } },
  exports:             { v3: { schema: null, tabla: "exports" },             test_v4: { schema: "test", tabla: "exports_v4" } },
  summaries:           { v3: { schema: null, tabla: "summaries" },           test_v4: { schema: "test", tabla: "summaries_v4" } },
  user_clipping_state: { v3: { schema: null, tabla: "user_clipping_state" }, test_v4: { schema: "test", tabla: "user_clipping_state_v4" } },
  notes_precarga:      { v3: { schema: null, tabla: "notes_precarga" },      test_v4: { schema: "test", tabla: "notes_precarga_v4" } },
  reportes:            { v3: { schema: null, tabla: "reportes" },            test_v4: { schema: "test", tabla: "reportes_v4" } },
};

type Entorno = "production" | "preview" | "development";

function entorno(): Entorno {
  // VERCEL_ENV lo pone Vercel; en local no existe.
  const v = process.env.VERCEL_ENV;
  if (v === "production" || v === "preview") return v;
  return "development";
}

/**
 * Resuelve el plano activo, con las dos guardas del runbook.
 *
 * PRODUCCIÓN NUNCA PUEDE SER `test`. Y no lanza excepción cuando alguien la configura mal:
 * fuerza `v3` y grita por consola. Razonamiento: el riesgo que estamos tapando es que
 * producción sirva datos de prueba, y forzar `v3` ya lo tapa. Lanzar tiraría abajo la
 * herramienta que usa el cliente por un typo en una variable — el remedio sería peor que la
 * enfermedad. Lo que no se puede es que quede invisible, de ahí el `console.error`.
 */
export function planoActivo(): Plano {
  const pedido = (process.env.KETCHUM_DATA_PLANE ?? "").trim().toLowerCase();
  const env = entorno();

  if (pedido === "" || pedido === "v3") return "v3";

  if (pedido !== "test") {
    console.error(
      `[data-plane] KETCHUM_DATA_PLANE="${pedido}" no es un valor válido. ` +
        `Valores admitidos: "v3" | "test". Se usa "v3".`,
    );
    return "v3";
  }

  if (env === "production") {
    console.error(
      "[data-plane] KETCHUM_DATA_PLANE=test en PRODUCCIÓN. Ignorado a propósito: " +
        "producción sirve siempre el plano v3. Revisar la configuración del proyecto en Vercel.",
    );
    return "v3";
  }

  return "test_v4";
}

/** `true` cuando la herramienta está mirando el plano v4 aislado. */
export function enPlanoV4(): boolean {
  return planoActivo() === "test_v4";
}

/**
 * La configuración del cliente (medios, tiers, keywords, secciones, alertas) es **compartida**:
 * la v4 la lee directo de las mismas tablas que edita la herramienta. Editarla desde una
 * preview sería tocar la operación real. Base de Datos queda de sólo lectura mientras el plano
 * no sea v3 — y el runbook pide deshabilitar los controles, no esconderlos.
 */
export function configEsSoloLectura(): boolean {
  return enPlanoV4();
}

/**
 * Respuesta única para acciones que todavía escriben configuración o datos exclusivos de v3.
 *
 * Importante: no alcanza con deshabilitar un botón. Las Server Actions se pueden invocar sin
 * pasar por la interfaz, así que cada mutación compartida debe consultar esta guarda antes de
 * abrir una conexión o ejecutar un RPC legado.
 */
export function rechazoEscrituraCompartida(): { ok: false; error: string } | null {
  if (!enPlanoV4()) return null;
  return {
    ok: false,
    error:
      "Esta acción está bloqueada en la vista de prueba v4: modificaría datos compartidos de la v3.",
  };
}

/** Nombre físico de una tabla lógica en el plano activo. Para mensajes y tests. */
export function destino(tabla: TablaLogica): Destino {
  return MAPA[tabla][planoActivo()];
}

/** Etiqueta legible del plano, para mostrar en pantalla cuando no es el de producción. */
export function etiquetaPlano(): string | null {
  return enPlanoV4() ? "Plano de prueba v4 (test)" : null;
}

/**
 * El acceso. Se le pasa el cliente de Supabase ya creado (server o middleware) y el nombre
 * lógico; devuelve el query builder apuntado al schema y la tabla correctos.
 *
 *   const supabase = await createClient();
 *   const { data } = await tabla(supabase, "notes").select("id, titulo").eq("clipping_id", id);
 *
 * El tipo de `cliente` es genérico a propósito: este módulo no debe importar el tipo del
 * cliente de Supabase ni forzar a las pantallas a un tipo concreto.
 */
export function tabla<
  C extends {
    from: (t: string) => unknown;
    schema: (s: string) => { from: (t: string) => unknown };
  },
>(cliente: C, logica: TablaLogica) {
  const d = destino(logica);
  return d.schema === null
    ? (cliente.from(d.tabla) as ReturnType<C["from"]>)
    : (cliente.schema(d.schema).from(d.tabla) as ReturnType<C["from"]>);
}
