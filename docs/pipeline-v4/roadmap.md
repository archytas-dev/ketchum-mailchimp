# Roadmap · Pipeline v4 de Clipping

El plan de construcción: fases, orden, dependencias y tickets. El **qué y el cómo** (arquitectura, modelo de datos, decisiones, alternativas) están en [`design-doc.md`](./design-doc.md) — este doc no los repite.

**Estado:** en construcción · **Rama:** `feat/pipeline-v4` (fuente de verdad de la v4) · **Última actualización:** 2026-09-03

---

## Índice

1. [Por qué](#1-por-qué)
2. [Decisiones de enfoque](#2-decisiones-de-enfoque)
3. [Las fases](#3-las-fases)
4. [Camino crítico](#4-camino-crítico)
5. [Riesgos y gates](#5-riesgos-y-gates)

---

## 1. Por qué

En 3 semanas el cliente cargó **601 reportes de calidad** sobre los clippings. Tres grupos concentran el 90%: **no entró una nota** (~168), **nota vieja o repetida** (~34 medidos, más en Slack), **nota no relevante** (~191). La v4 rehace la capa de **fetch y de filtrado** — no toca la capa de datos que la v3 ya resolvió bien. Diagnóstico completo y medido: `pipeline-v4.md`. Diseño: `design-doc.md`.

**Los dos principios:** (1) a la hora del corte no se sale a buscar nada; (2) el envío puede salir peor, nunca puede no salir.

---

## 2. Decisiones de enfoque

1. **Alcance entrelazado.** Las mismas fases cubren n8n + el modelo de datos + las pantallas del dashboard.
2. **La v4 reemplaza a la v3 sin migrarla primero** (leapfrog). La v3 sigue en la cuenta compartida hasta el cutover, cliente por cliente; el golden compara contra la v3 real.
3. **Granularidad híbrida.** Lógica pura → funciones de Postgres (una definición, cuatro clientes). Entrada/salida y orquestación → subworkflows de n8n con contrato fijo y traza propia.
4. **Trackeo con ledger en Supabase** (`pipeline_runs` + `stage_events` + `log_stage()`) + un Error Workflow global + la tabla de descartes para el detalle nota por nota.
5. **Rama aislada.** Todo el trabajo de v4 vive en `feat/pipeline-v4`; nada a `main` sin fase cerrada + revisión de un segundo.
6. **Un recolector por cliente, no uno compartido.** Cuatro recolectores que reusan los mismos ladrillos con parámetros distintos. Se descartó el recolector único por riesgo de que una corrida de ~1.800 medios agote recursos y se caiga.
7. **Barrido cada ~3 h**, no tres pasadas nocturnas: 08:00 · 11:00 · 14:00 · 17:00 · 20:00 · 23:00 · 02:00 · 05:00 y una última a las **06:30**. Hay medios que rotan sus notas a lo largo del día.
8. **Deduplicación al guardar.** En cada barrido, una nota cuya URL canónica ya está en el pool del día se ignora; solo entran URLs nuevas. Es un filtro distinto del que compara contra lo ya enviado en días anteriores; los dos van.
9. **Schema de prueba: se reusa y se asegura el que ya existe** (`test`). Se le activa el control de acceso por fila, se le revocan al rol anónimo los permisos de borrado, y se lo sincroniza con producción. El pipeline escribe ahí cuando arranca por botón, y en producción cuando arranca por cron.

---

## 3. Las fases

En orden de dependencia. Cada una es reversible y no toca lo que el cliente usa hoy hasta la Fase 8.

### Fase 0 · Higiene y base — `pendiente`

Limpia la deuda que, si no, ensucia todo lo que viene (sobre todo la medición del gate de la Fase 2). Varios ítems tocan la cuenta compartida → se coordinan con el responsable de esa cuenta.

| # | Cambio | Por qué | Riesgo |
|---|---|---|---|
| 0.1 | Relevar y apagar las corridas duplicadas en la cuenta compartida (cada cliente dispara hoy varios pipelines al mismo minuto). | Le pegamos varias veces a cada fuente desde la misma IP → parte del bloqueo puede ser autoinfligido. Medir con esa carga da un número falso. | Workflows activos de producción. |
| 0.2 | Re-medir el bloqueo de fuentes tras apagar los duplicados. | Ajusta el alcance de la Fase 2. | Solo lectura. |
| 0.3 | Rotar la API key de scraping expuesta en texto plano en el nodo de config de los cuatro clippings. | Credencial expuesta = alguien puede quemar la cuota paga. | Los cuatro flujos fallan en el intervalo entre rotar y actualizar. |
| 0.4 | Quick win de valorización: `tier_norm()` de los dos lados del cruce nombre↔tier. Medido: 16% → 36%. | Plata que el cliente deja sobre la mesa todos los días. No depende de la v4. | Único ítem que toca una función de la v3; aditivo, va con revisión + TEST. |
| 0.5 | Limpiar el historial anti-repetición: script único que desenvuelve las URLs de redirector guardadas crudas y colapsa duplicados. | Una URL de redirector cruda nunca vuelve a matchear la real → la nota se re-envía para siempre. La Fase 4 hereda este historial. | Bajo — tabla de soporte. |
| 0.6 | Asegurar el schema `test` (control de acceso por fila + revocar del rol anónimo el borrado) **sin romperlo** — la v3 lo usa y la v4 lo va a reusar. Cerrar aparte el backup congelado. | Bug de seguridad: cualquiera con la clave pública del front puede leerlo o vaciarlo. | Romper el modo TEST de la v3 si no se verifica primero. |
| 0.7 | Corregir el `client_id` de escritura de la v3 (par vivo/histórico) y apagar el clipping duplicado de uno de los clientes. | Datos que aterrizan en el identificador equivocado no los ve nadie. | Bajo, previa verificación. |

**Salida:** números limpios para medir la Fase 2, deuda de seguridad cerrada, valorización arreglada en producción — sin escribir una línea de v4.

**Tickets:** `[F0.1]` relevar+apagar corridas duplicadas · `[F0.2]` re-medir bloqueo · `[F0.3]` rotar API key expuesta · `[F0.4]` `tier_norm()` de los dos lados (+revisión +TEST) · `[F0.5]` script de limpieza del historial · `[F0.6]` asegurar `test` + cerrar el backup · `[F0.7]` corregir `client_id` v3 + apagar clipping duplicado.

### Fase 1 · Modelo de datos — `✅ aplicada (03/09)`

- Modelo de medios en tres tablas (catálogo global, fuentes por sección, suscripción por cliente) + estrategia de transporte aprendida. Poblado leyendo la tabla actual de medios.
- Reglas de filtrado como datos, prompts de cliente versionados, log de intentos, pool crudo de candidatas.
- Ledger (corridas + eventos de etapa) con sus RPC.
- Funciones puras: `tier_norm` (final); `url_canonica`, `resolver_fecha`, `es_repetida` (v1, se endurecen en Fase 4).

**Estado:** 11 tablas nuevas (con RLS) + 6 columnas en `notas_descartadas` + 6 funciones, aplicadas a producción. `get_advisors` sin hallazgos nuevos en `public`. Catálogo poblado: 1.542 dominios · 1.542 fuentes · 2.102 suscripciones.

**Tickets:** `[F1.1]`–`[F1.7]` migraciones + RLS ✅ · `[F1.8]` poblar el catálogo ✅ · `[F1.9]` aplicar + advisors ✅.
*(El schema de prueba salió de esta fase — se reusa `test`, se asegura en la Fase 0 y se sincroniza en la Fase 3.)*

### Fase 2 · Transporte y cobertura — `🔨 gate, en curso`

- **`sub/fetch-source`** ✅ — una fuente, un transporte → contrato + `fetch_log`. Probado (directo / cloudflare / aws contra feeds reales).
- **`sub/fetch-escalera`** ✅ — la escalera `directo → cloudflare → aws`, corta en el primero con notas. Probado.
- **`wf/descubridor` (A0)** — descubre formato × transporte por dominio, recupera las fuentes rotas o sin url. Pendiente.
- **Workflow de medición aislado** ✅ construido, **sin disparar** — recorre las ~1.262 fuentes, no manda mail ni toca tablas de cliente. Produce **el número que decide si la v4 vale la pena**.

**Gate:** si la medición recupera pocas fuentes, se replantea el alcance de la v4. *(Dato del smoke-test: grandes diarios que el diagnóstico daba por bloqueados entran por directo — el problema puede ser más chico de lo estimado.)*

**Tickets:** `[F2.1]` `sub/fetch-source` ✅ · `[F2.1b]` `sub/fetch-escalera` ✅ · `[F2.2]` `wf/descubridor` (A0) · `[F2.3]` workflow de medición ✅ (falta disparar + decidir dónde vive el proxy AWS en prod) · `[F2.4]` decisión de gate con el número en mano.

### Fase 3 · Recolector por cliente + schema de prueba — `pendiente`

- **Sincronizar el schema `test` con producción** (agregarle las tablas nuevas de la v4).
- **`wf/recolector-cliente`** — un workflow por cliente. Barrido cada ~3 h + 06:30. Recorre las fuentes de *ese* cliente por `sub/fetch-escalera`, con control de concurrencia y lote.
- **Deduplicación al guardar** por URL canónica: cada barrido suma solo lo nuevo.
- Cierre de cobertura + aviso por barrido.
- Los cuatro recolectores usan los mismos ladrillos; cambian los parámetros por cliente.

**Salida:** el pool de cada cliente se llena a lo largo del día en `test`, en paralelo a su v3.

**Tickets:** `[F3.1]` sincronizar `test` con `public` · `[F3.2]` `wf/recolector-cliente` (plantilla) · `[F3.3]` dedup al guardar por URL canónica · `[F3.4]` instanciar el recolector ×4 con sus parámetros y horarios · `[F3.5]` cierre de cobertura + aviso.

### Fase 4 · Normalización + compuertas — `pendiente`

- Completar `url_canonica` con el decode de los redirectores del agregador.
- `normalizar_y_compuertas()`: normaliza → resuelve fecha (cascada, nunca inventa) → deduplica (una regla) → tres compuertas.
- Poblar `reglas_filtro` traduciendo el JavaScript de los cuatro workflows, una sola vez.
- Cada descarte se escribe con la regla exacta y el valor que la disparó.
- Reconstruir el historial anti-repetición con la URL canónica.

**Cierra:** el grueso de "fuente extranjera", "vieja / repetida", la mitad de "no relevante", y "exclusiva que no entró".

**Tickets:** `[F4.1]` `url_canonica` decode de redirectores · `[F4.2]` `normalizar_y_compuertas()` · `[F4.3]` poblar `reglas_filtro` desde el JS actual · `[F4.4]` escritura de descartes con regla + valor · `[F4.5]` reconstruir el historial con URL canónica.

### Fase 5 · Los agentes — `pendiente`

- **`sub/llm-call`** compartido: llamada + un retry + backoff 429 + tope de tokens/cliente/día + registro de tokens y costo.
- **`sub/agent-A1` (completador):** detecta qué falta y lo busca; limpia HTML, corta el sufijo del medio en títulos, reemplaza descripción cruzada.
- **`sub/agent-A2` (juez):** veredicto por nota con el prompt del cliente + secciones, en lotes, con escalado a modelo grande ante duda. **No puede descartar** fuente prioritaria ni nota con marca del cliente — solo decide la sección.
- **`sub/agent-A3` (auditor):** ve el clipping entero; chequeos duros (saca la nota, no frena), blandos (avisan), repesca de descartes dudosos.

**Cierra:** "no relevante", "sección incorrecta", "formato", el ruido de volumen.

**Tickets:** `[F5.1]` `sub/llm-call` · `[F5.2]` `sub/open-article` · `[F5.3]` `sub/agent-A1` · `[F5.4]` `sub/agent-A2` con la restricción de prioritarios/marca · `[F5.5]` `sub/agent-A3` con chequeos + repesca.

### Fase 6 · Armado, salida y degradación — `pendiente`

- **`armar_clipping()`** (SQL, determinístico): orden de secciones, ad value, resumen.
- **`decidir_nivel()`:** elige el nivel de salida 0–3 según qué etapas anduvieron. No puede devolver "no salgo".
- Guardar **primero** en la plataforma, marca de listo, después el mail leyendo lo guardado.
- **`sub/send-email`** con guarda dura (excepción si `modo != prod`). Misma guarda en el nodo que escribe el historial.
- **`sub/slack-notify`** consolidado.
- Idempotencia: re-ejecutar el mismo día = mismo clipping + un solo mail.
- **`wf/salud`:** cobertura, fuentes mudas, volumen esperado **por día de la semana**.

**Cierra:** "formato: página caída" (el auditor muestrea links) y el silencio de los días rotos.

**Tickets:** `[F6.1]` `armar_clipping()` · `[F6.2]` `decidir_nivel()` · `[F6.3]` `sub/send-email` con guarda dura · `[F6.4]` `sub/slack-notify` · `[F6.5]` idempotencia · `[F6.6]` `wf/salud` con umbrales por día de semana · `[F6.7]` `wf/error-handler` global.

### Fase 7 · Dashboard — `pendiente` *(corre en paralelo desde el fin de la Fase 1)*

- **"Notas que no entraron"** sobre Actividad: fuente, motivo, regla, valor que matcheó, botón para subirla. Al subir, la regla suma un error; a los tres, queda marcada para revisar.
- **"Reglas de filtrado":** cuánto descartó, cuántos errores, estado, por cliente y global.
- **"Salud de fuentes":** notas reales de 30 días, estado y transporte; aviso a los 14 días en cero.
- **"Medios sin valorizar":** ordenados por volumen, asignar tier ahí mismo, aviso semanal.
- **Sonda de alta inmediata:** pegás una URL → tres titulares reales en menos de un minuto, antes de guardar.
- **Historial de configuración:** toda alta/baja/bloqueo/tier con fecha de vigencia; se aplica en el próximo clipping, nunca sobre uno enviado.
- **Fixes puntuales:** el alcance no aparece en la precarga de exclusivas; el resumen toma solo la primera nota.

**Cierra:** las cientos de correcciones que hoy no alimentan nada.

**Tickets:** `[F7.1]`–`[F7.4]` las cuatro pantallas · `[F7.5]` sonda de alta · `[F7.6]` historial de configuración · `[F7.7]` fixes puntuales.

### Fase 8 · Golden + primer cutover (Booking) — `pendiente`

- **Golden:** la v4 decide idéntico a la v3 sobre los mismos datos del mismo día. Cada diferencia se explica antes de avanzar.
- **Staging obligatorio:** copia de un día real del piloto.
- **Cutover:** se activa el `wf/armado-cliente` del piloto; su v3 se desactiva, no se borra, 30 días.
- **Rollback definido antes de arrancar:** dos días fuera de banda, o una queja del cliente = volver (dos clicks).

**Piloto = Booking** (más chico y simple: 210 fuentes vs 640, 18 keywords vs 106, corre en 5 min). El error es el más barato: si la arquitectura falla, se ve en el contexto más limpio.
**BMS va segundo, no cuarto** — es donde más duele, pero ese dolor lo arreglan las Fases 2–4 (compartidas) y su recolector se construye en la Fase 3: BMS mejora en el schema de prueba desde la Fase 3, sin cortar nada.

**Tickets:** `[F8.1]` arnés de golden · `[F8.2]` staging del piloto · `[F8.3]` cutover de Booking · `[F8.4]` disparador de rollback + monitoreo.

### Fase 9 · Replicar al resto — `pendiente`

- Mismo pipeline. Cambia el identificador de cliente, el prompt, las suscripciones y el horario. Un cliente nuevo es una fila y un horario.
- Orden: **BMS → Mars → MSD.** Se confirma con los números de prueba de la Fase 6.
- Cada cutover desactiva la v3 de ese cliente. A los 30 días sin incidentes, se borran los workflows viejos y el modelo de medios con `client_id`.

**Tickets:** `[F9.1]` cutover BMS · `[F9.2]` cutover Mars · `[F9.3]` cutover MSD · `[F9.4]` baja de la v3 y del modelo viejo, pasados los 30 días.

---

## 4. Camino crítico

`Fase 0` → `Fase 1` ✅ → **`Fase 2` (gate)** 🔨 → `Fase 3` → `Fase 4` → `Fase 5` → `Fase 6` → `Fase 8` (piloto) → `Fase 9`

La **Fase 7** (dashboard) corre en paralelo: arranca apenas existan las tablas de descartes y de reglas, se completa contra las Fases 5 y 6.

Desde la Fase 3, el recolector de cada cliente corre en el schema de prueba en paralelo a su v3 — los números mejoran para los cuatro antes de cualquier cutover.

---

## 5. Riesgos y gates

- **Gate de la Fase 2:** la medición de cobertura recuperable. Si recupera poco, la v4 pierde su justificación principal — hay que saberlo antes de construir la ingesta.
- **Flujos en vuelo:** nada de la Fase 0 que toque la cuenta compartida se ejecuta sin coordinarlo con el responsable de esa cuenta.
- **Zonas horarias:** se resuelve antes de escribir el recolector. Todo en UTC, se decide en hora local; una fecha sin hora nunca se compara contra un corte horario.
- **Carga de n8n:** cuatro recolectores × ~9 barridos/día. Vigilar memoria y solapamiento; escalonar los horarios entre clientes si hace falta.
- **Proxy AWS en producción:** hoy vive en un proyecto de prueba. Decidir dónde vive antes de la Fase 3.
- **Drift de migraciones del repo** (preexistente): `supabase db push` no es seguro hasta reconciliar — ticket aparte.
- **Autor ≠ aprobador:** cada fase que promueve a `public` o activa un workflow necesita revisión de un segundo.
- **Fuera de alcance:** gacetillas, editor web y exportación, clientes en formato legado.
