# Pipeline v4 de Clipping — Inventario de workflows y pérdida de notas vs. v3

> **Qué es:** documento técnico de referencia sobre el pipeline v4 de clipping. Cubre dos cosas: (1) qué hace cada workflow de n8n construido hasta ahora, etapa por etapa; (2) un análisis consolidado — con números — de dónde se pierden notas respecto al pipeline v3 que sigue en producción.
>
> **Fuentes y fecha de corte:** `docs/pipeline-v4/roadmap.md` (bitácora de construcción, última entrada 2026-09-09) + `docs/pipeline-v4/design-doc.md` (arquitectura, con su tabla de estado desactualizada — ver §5) + inspección directa de la instancia n8n `n8n-ketchum` el 2026-09-10. Donde una fuente contradice a otra, se marca explícitamente en vez de elegir una.
>
> **Convención:** documento neutro — sin nombres de personas. Los nombres de cliente (BMS, Booking, Mars, MSD) sí se mantienen porque son entidades del negocio, no personas.

---

## Índice

1. [Qué es la v4, en una arquitectura](#1-qué-es-la-v4-en-una-arquitectura)
2. [Estado por fase](#2-estado-por-fase)
3. [Inventario de workflows](#3-inventario-de-workflows)
4. [Dónde se pierden notas respecto a la v3](#4-dónde-se-pierden-notas-respecto-a-la-v3)
5. [Discrepancias entre la documentación y el estado real](#5-discrepancias-entre-la-documentación-y-el-estado-real)
6. [Pendientes abiertos](#6-pendientes-abiertos)
7. [Glosario](#7-glosario)

---

## 1. Qué es la v4, en una arquitectura

El pipeline genera un clipping de prensa diario para cuatro clientes (BMS, Booking, Mars, MSD). La v3 (en producción, cuenta n8n compartida) tiene un workflow de ~90-100 nodos por cliente, con lógica de filtrado duplicada 4 veces. La v4 la reemplaza con dos capas separadas:

- **Recolección — una sola vez, compartida por los cuatro clientes.** Un catálogo único de medios (`medios_catalogo`/`_fuentes`/`_estrategia`) se recorre en barridos periódicos; cada nota nueva (por URL canónica) cae a un pool del día (`candidatas_raw`) **sin `client_id`** — a propósito, para no traer la misma nota cuatro veces.
- **Armado — una vez por cliente, ~10 minutos antes de su horario de corte.** Filtra el pool por las suscripciones de ese cliente (`medios_suscripcion`), lo pasa por normalización + compuertas determinísticas, tres agentes (completa → juzga → audita), arma el clipping y decide un nivel de salida (0 = completo, 3 = degradado a "el de ayer").

Dos ejes que la v3 tenía mezclados en una sola columna y la v4 separó: **transporte** (por dónde se sale a internet: directo, proxy Cloudflare, proxy AWS, Bright Data) y **método de extracción** (cómo se convierte la fuente en notas: `feed` o `html`). Son independientes — una fuente puede tener un feed impecable y ser inalcanzable desde la IP de n8n, o ser perfectamente alcanzable pero no tener feed.

El detalle completo de arquitectura, modelo de datos y decisiones descartadas está en `design-doc.md` — no se repite acá. Este documento se concentra en **qué hace cada pieza construida** y **qué tan bien cubre lo que la v3 ya cubre hoy**.

---

## 2. Estado por fase

El roadmap numera la construcción en 10 fases (0 a 9). Estado al 2026-09-09 (el header del documento dice "última actualización 08/09", pero tiene contenido fechado 09/09 — ver §5):

| Fase | Alcance | Estado |
|---|---|---|
| **0 · Higiene** | Apagar corridas duplicadas · rotar API keys expuestas de la v3 · quick-win de valorización · limpiar historial · asegurar schema de prueba · corregir `client_id` | **Omitida** (decisión explícita). Sigue siendo deuda real — ver §6. |
| **1 · Modelo de datos** | 11 tablas nuevas + columnas + funciones + poblado del catálogo | ✅ Aplicada a producción. 1.542 dominios · 1.542 fuentes · 2.102 suscripciones. |
| **2 · Transporte y cobertura** | Los dos subworkflows de fetch + medición + descubridor (A0) | ✅ Cerrada. 1.112 de 1.437 fuentes activas (77%) terminan con un transporte que funciona. |
| **3 · Recolector compartido + schema de prueba** | El recolector real, su driver de cron, re-verificación periódica | **Formalmente "en curso"** (nunca se cierra en el índice del roadmap), pero todo construido salvo sincronizar el schema de prueba, que se pospuso a propósito. Ver §5 sobre si el cron está prendido hoy. |
| **4 · Normalización + compuertas** | Función SQL única de fecha+dedup+compuertas, reglas migradas de la v3 | ✅ Cerrada. 30 reglas migradas (11 globales + por cliente). |
| **5 · Agentes** | Los tres agentes + los ladrillos de LLM y apertura de artículo + el camino HTML completo | ✅ Cerrada. |
| **6 · Armado + degradación** | `armar_clipping()`, `decidir_nivel()`, envío con guarda dura, error-handler, salud | ✅ Cerrada. |
| **7 · Dashboard** | 4 pantallas nuevas + changelog de config | Pendiente — sin ítems marcados como hechos. |
| **8 · Golden + cutover Booking** | Comparar decisión por decisión contra la v3, después migrar el primer cliente | **Bloqueada hasta el 08/09** por tres bugs de volumen (§4); destrabados, pero el golden completo **todavía no se corrió** — solo una muestra de 25 candidatas en un cliente. |
| **9 · Replicar** | BMS → Mars → MSD | Pendiente. No es trabajo de construcción — el pipeline ya es compartido para los cuatro desde la fase 3-6; son tres decisiones de cutover. |

---

## 3. Inventario de workflows

Todos viven en la instancia dedicada `n8n-ketchum`, organizados con el prefijo `v4 · <categoría> · <nombre>`. IDs verificados en vivo el 10/09.

### 3.1 Recolección (llenan el pool compartido `candidatas_raw`)

| Workflow | ID | Trigger | Qué hace |
|---|---|---|---|
| **recolección · recolector feeds** | `tzcHSIUdMGXVRFIo` | Webhook `POST /v4-recolector` (nunca botón manual — retiene el set en memoria y muere con volumen alto) | Lee la vista de fuentes pendientes (tope 120 por tanda), rutea por `transporte` (directo/cloudflare/aws/brightdata, cada uno con su propia credencial — mezclarlas hizo fallar el 100% de los pedidos por AWS en una prueba), parsea RSS/Atom/sitemap, escribe `fetch_log` siempre y `candidatas_raw` solo en modo prod, con `on_conflict` explícito para no perder el lote entero si una fila choca contra el índice único. |
| **recolección · barrido feeds** | `wEuM4z6hIuLGwQFF` | Cron, 9 ventanas/día (08·11·14·17·20·23·02·05 ART + 06:30) o webhook manual | El driver: llama al recolector en un loop en serie (nunca en paralelo — dos tandas simultáneas se pisarían) hasta que la vista de pendientes se vacía o se agotan 25 tandas. |
| **recolección · recolector html** | `p6MFCVE8Ggx65Npq` | Webhook | Espejo del recolector de feeds para fuentes **sin feed** (`metodo_extraccion='html'`): baja la home, extrae notas con heurística sin IA (mismo dominio, descarta rutas de navegación, exige que "parezca nota" por fecha en la URL / slug largo / id numérico, título ≥25 caracteres, dedup por URL). La fecha sale únicamente de la URL — nunca inventada. `fuente_id` es obligatorio en la práctica: sin él la nota no puede unirse a ningún cliente en el armado. |
| **recolección · barrido html** | `Zm8OhzNmu0uLs2JA` | Cron, mismas 9 ventanas + 15 min de offset respecto al de feeds | Driver del recolector html. |
| **recolección · alertas google** | `WfKUwnGWabKVMFo9` | Cron, mismas 9 ventanas + 30 min de offset | Construido el 08/09 para cerrar el gap de Google Alerts/News (ver §4). Fetchea los feeds de Google Alerts activos, **desenvuelve el redirect** `google.com/url?...&url=<real>` antes de guardar (si no, todo el pool quedaría con dominio `google.com`, rompiendo tiers/bloqueados/dedup) y corta el sufijo `" - Medio"` del título. Es la única recolección cuyo modo por defecto es `prod`, no `test`. |
| **mantenimiento · re-verificar transporte** | `y5UXitrQdQ5UkKL4` | Cron diario 07:15 ART | Re-prueba periódicamente los transportes distintos al que ya está funcionando (contra degradación silenciosa); a los 5 fallos consecutivos pasa `transporte=NULL` en vez de desactivar la fuente. |
| **mantenimiento · medir-html** | `wqHvLCVH4mcTWdvl` | — | Mide/verifica transporte específicamente para las fuentes sin feed, subiendo la escalera completa. Deja el transporte ganador en `medios_estrategia`, igual que el recolector de feeds. |

### 3.2 Piezas (subworkflows-ladrillo, contrato fijo, los llaman los orquestadores)

| Subworkflow | ID | Qué hace |
|---|---|---|
| **pieza · fetch-source** | `UUIlvhTv3Rjy9YEP` | 1 fuente + 1 transporte → contrato único (`{diagnostico, http_status, items[], articulos, con_fecha, ms}`) + fila en `fetch_log`. Switch por transporte, cada rama con su propio nodo HTTP y credencial. |
| **pieza · fetch-escalera** | `TyXVALaeUzfPlgv8` | Prueba `directo → cloudflare → aws` en orden, llamando a fetch-source 1 a 3 veces. Corta en el primero con `articulos > 0`; escala solo si `diagnostico ∈ (bloqueado, caído, timeout)` — nunca ante `sin_items` (eso no se arregla cambiando de transporte). |
| **pieza · fetch-page** | `kwyBxom1AVrwQJ8m` | Separado de open-article el 07/09 porque eran "dos trabajos con el mismo nombre". Ladrillo puro: URL + transporte → HTML crudo. Detecta y corrige el charset (latin1 vs utf-8, con inferencia si el header no lo declara), trunca a 800KB (35 dominios con HTML sin truncar retenían ~21MB, 70 tumbaban el proceso), y distingue `metodo_rechazado` (405/400, no se arregla reintentando) de `vacío` (200 sin ningún enlace) de `charset_roto` (pide escalar transporte). |
| **pieza · open-article** | `mnofS4TurFRTVRsh` | Abre **una** nota puntual (no una lista) y saca título/copete/fecha tal como los declara el sitio (`article:published_time`, JSON-LD, `<time datetime>`) — nunca deducidos ni inventados. Es la única fuente de fecha confiable para notas de fuentes HTML. Medido sobre una muestra: recupera fecha en 2 de 8 casos (25%) — complementa, no reemplaza, a la compuerta que frena lo evergreen. |
| **pieza · llm-call** | `8xgMfLdQLuwkpVgr` | Único punto de contacto con OpenAI de toda la v4 (contraste directo con la v3, que tiene la API key en texto plano en un nodo `Set`). Antes de llamar, en un solo viaje a la base trae el prompt vigente + el tope diario de tokens + el consumo ya gastado; corta si no hay prompt vigente o si ya se gastó el tope. Un reintento con backoff solo ante errores transitorios (429/408/5xx). Escribe tokens y costo en `stage_events`. |
| **pieza · agent-A1 completador** | `E5JLokzkBxeCyLzv` | **Determinístico, sin LLM salvo que necesite abrir la nota.** Decodifica entidades HTML, corta el sufijo de medio en el título si se parece al dominio, detecta "copete cruzado" (0 palabras en común con el título) y solo ahí llama a open-article. |
| **pieza · agent-A2 juez** | `9pwrSH2KdpGhbXjS` | Juzga relevancia + geografía + sección en lotes de 12 notas por llamada, con ids cortos (1..N) en vez de uuid para ahorrar tokens. Dos restricciones impuestas en **código**, no en el prompt: no puede descartar una nota de fuente prioritaria (se pisa el veredicto si lo intenta) y no puede inventar una sección fuera de la lista real del cliente. Una nota sin veredicto del modelo nunca desaparece: queda marcada `sin_veredicto`. |
| *(agent-A3 auditor)* | — | No existe como subworkflow n8n separado — su lógica (chequeos duros que sacan la nota sin frenar el envío, chequeos blandos que solo avisan, repesca de descartes con score 0,4–0,6) terminó viviendo en funciones SQL, invocadas desde `armado-cliente`. |
| **pieza · send-email** | `4K8k0C1ptXdSiSdB` | Único subworkflow que puede escribirle a un cliente real. Dos guardas independientes: una excepción dura en código si `modo != 'test'`, y el nodo de Gmail **nace deshabilitado**. Hoy todo mail de prueba va solo a destinatarios internos. |
| **pieza · slack-notify** | `Gf7f1x1qa5l6ssPe` | Construido pero **inactivo** — decisión operativa: ningún workflow v4 puede notificar hacia afuera hasta el cutover. |

### 3.3 Orquestadores

| Workflow | ID | Trigger | Qué hace |
|---|---|---|---|
| **clipping · armado-cliente** | `ORrmePsGxJJxISTo` | Sin cron todavía (a propósito, hasta que el golden lo confirme) + 4 cron de "ensayo" a la misma hora que el envío real de cada cliente en la v3, siempre en modo prueba | El orquestador más grande (42 nodos) y el más tocado del proyecto. Arquitectura contra falta de memoria: cada ejecución reclama **una página** de candidatas (tamaño bajado de 200 a 20), la procesa entera (A1 → lotes de 12 al A2 → dedup de veredictos repetidos → guarda), cierra la página y **dispara otra ejecución independiente por webhook** para la siguiente — nunca un loop dentro del mismo grafo. Al agotar el pool: arma el clipping, audita, decide el nivel de salida, todo en un solo viaje SQL. El email de prueba reconstruye el HTML de los 4 templates de la v3 (copiado 1:1, con su lógica de tiers/ad value/secciones) para poder comparar el resultado real contra lo que hoy manda la v3. |
| **mantenimiento · descubridor (A0)** | `nvShglwLuHqgF5cp` | Webhook por tandas, nunca botón manual | Encuentra transporte y feed para fuentes sin ninguno de los dos: prueba ~17 rutas por dominio saliendo por el proxy Cloudflare, más una vuelta leyendo lo que la home declara (`<link rel="alternate">`, `robots.txt`). Escribe solo lo verificado. Reescrito el 08/09 para delegar todo el trabajo pesado al proxy (un único `GET ?descubrir=1&dominio=`) — ya no retiene HTML en n8n. |
| **operación · error-handler** | `X48CQZrLOlJXOiwb` | Error Workflow asignado a los orquestadores v4 (no a las piezas, cuyo error ya sube a quien las llamó) | Guarda el fallo en una tabla propia primero; el paso de aviso hacia afuera existe pero está deshabilitado (misma decisión que Slack). Verificado explícitamente: con el handler apagado, un fallo real no dejaba rastro en ningún lado — de ahí la prioridad de tener esto andando antes que nada más. |
| **operación · salud** | `1DH5Sw3bcul166SJ` | Cron diario 09:00 ART | Casi toda la lógica vive en una función SQL, no en n8n: compara la cobertura del día contra las últimas 4 apariciones del mismo día de la semana (si hay menos de 2 muestras previas, no avisa nada). Silencio = anduvo bien. |

### 3.4 Archivados / fuera de alcance de este inventario

- Tres workflows con prefijo `ZZ · archivo ·`: mediciones puntuales de la Fase 2 (cobertura, escalera) que ya cumplieron su función — una de ellas está marcada explícitamente "rota, no usar".
- `Ketchum · v4 · extraer prompts de la v3` (`usaCmyYb2N62U8FD`): workflow de un solo uso, de solo lectura, que extrajo por API los prompts que la v3 tiene hardcodeados, para migrarlos a la tabla de prompts versionados sin transcribirlos a mano.
- Los cuatro clippings `Ketchum — <Cliente> Clipping v3` existen importados en esta instancia con `active:false` — son una copia de referencia; la v3 real sigue corriendo en la cuenta n8n compartida, no acá.
- Herramientas de prueba (`v4 · prueba · disparador de llm-call`) — tooling de desarrollo, no parte del pipeline.

---

## 4. Dónde se pierden notas respecto a la v3

Esta sección resume, con números, todo lo que el proceso de construcción fue midiendo al contrastar contra lo que la v3 manda hoy. Orden: de la causa que más pesa a la que menos.

### 4.1 El canal de Google Alerts / Google News — la causa individual más grande

La v4 nació sin ningún mecanismo para este canal — no era un bug, era un canal que el diseño original no contemplaba (se apoyaba solo en feeds, HTML y el descubridor). Verificado: cero notas de dominio `google.com` en el pool antes del 08/09.

- Contraste medido el 08/09 contra un clipping real de la v3 (238 notas): la v4 tenía el **65%** en total, pero desglosado por canal la diferencia es enorme — **76%** de lo que viene de fuente propia, apenas **41%** de lo que viene por Google Alerts / Google News. Ese canal pesa **31% del clipping de la v3**, y esas 43 notas que faltaban son **más de la mitad de todo lo que le faltaba a la v4** ese día.
- Al construir el workflow dedicado (mismo día, §3.1) y desenvolver el redirect de Google (`google.com/url?...&url=<real>`), la cobertura total del mismo clipping subió de **65% a 79,4%** (Google Alerts/News: 41% → 72,6%).
- Lección de método: comparar solo por URL subestima el número — la v3 guarda el link con el que encontró la nota (el del redirector), no el del medio real. Decodificando el redirect y cruzando también por título+dominio (necesario para Google News RSS, cuyo token no se puede reconstruir), la cifra pasa de 48% a 65%. El arnés de comparación (`scripts/golden-diff.mjs`) cruza por las dos vías a propósito.

### 4.2 Fuentes propias que el barrido nunca intenta

De 40 notas de fuente propia que la v3 mandó y la v4 no tenía (medición del 08/09):

- 25 son notas que el medio no listó en su feed (fetch correcto, nota ausente).
- **14 son de medios activos que el barrido directamente no intenta** — la vista de fuentes pendientes exige `transporte IS NOT NULL`, así que una fuente a la que la Fase 2 no le encontró transporte queda fuera del barrido **para siempre**, sin reintento automático. Son 253 de 1.437 fuentes activas (17,6%).
- 1 nota es de un medio sin cargar en el catálogo.

De esas 253 fuentes sin transporte, el supuesto de que la mayoría estaba bloqueada era el equivocado: **216 (85%) responden bien pero la URL que se tiene no sirve** (feed vacío, no es un feed real, 404, caído). **Bloqueo real: 7.** El cuello de botella no es de red, es de configuración de fuentes — correr el descubridor sobre esas 216 es lo que más cobertura rinde de lo que queda.

Cobertura de fuentes propias por cliente (04/09): BMS 62% (la pila de deuda más grande, 217 fuentes rotas o sin URL), MSD 66%, Mars 70%, Booking 75%. Confirmado el patrón esperado: el cliente con peor cobertura es el que más reportes de "no entró una nota" genera.

### 4.3 Ruido de ingesta que había que sacar antes de poder medir nada

El 42% del pool llegaba sin fecha confiable, y no era un problema del resolvedor de fechas sino de qué se estaba trayendo: 5 dominios con índices históricos completos aportaban el 74% de ese ruido, y un solo medio aportaba el 23% del pool entero (sin ninguna fecha en su sitemap). Sacarles el transporte bajó el pool de 52.464 a 39.613 notas y **subió** la proporción útil (con fecha confiable: 58% → 92%; de las últimas 24h: 15.059 → 18.328).

### 4.4 Historial de repetidas contaminado

De 9.806 filas del historial anti-repetición, el 53% eran URLs de redirector crudas que nunca vuelven a coincidir con la URL real — esas notas se podían reenviar indefinidamente sin que el dedup las viera. Reconstruido con la URL canónica real: 47% → 78% del historial queda utilizable (2.168 filas quedan irrecuperables porque la v3 pasaba el token del redirector a minúsculas, destruyendo información que sí distingue mayúsculas).

### 4.5 Por qué costó tanto empezar a comparar en serio (no un problema de notas perdidas, sino de la propia comparación)

Probar siempre con el cliente más chico (elegido como piloto por bajo riesgo) escondió tres bugs que solo aparecen con volumen:

1. La consulta que arma el pool del día tarda ~21s para el cliente más grande; el límite de la capa REST corta a los 3-8s. El armado devolvía "pool vacío" con miles de candidatas esperando — **un fallo disfrazado de resultado**, no una medición real de cobertura.
2. El armado juzgaba un lote de 30-80 sobre un pool de 1.567 a 5.359 candidatas — comparar contra la v3 (que mira todo lo suyo) sobre el 2% de eso no es una comparación válida.
3. El juez devolvió dos veredictos para la misma nota en una corrida; como no había deduplicación antes de guardar, el conflicto de base hacía perder el **lote entero**, no solo esa fila.

Los tres están resueltos (paginación más chica, deduplicación antes de escribir), pero explican por qué el golden completo (comparar TODAS las decisiones de un cliente contra la v3) todavía no se corrió — solo una muestra acotada.

### 4.6 Descripciones faltantes (hallazgo más reciente, sin resolver)

Mismo día de comparación, mismo cliente: la v3 mandó 77 notas con solo 3 sin descripción (4%); la v4 devolvió 102 notas con **29 sin descripción (28%, siete veces peor)**. Causa: el extractor de artículo no encuentra descripción en sitios que arman el cuerpo con JavaScript (el fetch simple no lo ve) — de 14 dominios afectados, 5 son medios monitoreados obligatorios para ese cliente. Sin resolver al cierre de la última entrada del roadmap; la solución propuesta es renderizar la página en vez de leer el HTML crudo, como ya hace la v3.

### 4.7 Ad value — no es pérdida de notas, pero es la misma familia de bug

El cruce de valorización seguía haciéndose por nombre de medio (nunca matcheaba). Se corrigió anclando por `fuente_id` → tier de la suscripción. Verificado con datos reales: el valor total de un clipping pasó de **$0 a $29.600.000**.

### Resumen de cobertura total medida

| Momento | Cobertura vs. clipping real de la v3 |
|---|---|
| 08/09, antes de Google Alerts | 65% (fuente propia 76%, Google 41%) |
| 08/09, después de construir el canal de Alertas | **79,4%** (fuente propia 82,4%, Google 72,6%) |

No hay una medición más reciente registrada en el roadmap — el golden completo (decisión por decisión, no solo presencia/ausencia de la nota) sigue pendiente.

---

## 5. Discrepancias entre la documentación y el estado real

- **`design-doc.md` está desactualizado respecto al código.** Su tabla de estado (§9) dice "Fase 3 en curso" con fecha 2026-09-04 y lista solo 3 workflows. La instancia real, al 10/09, tiene 21 workflows v4 activos cubriendo recolección, transporte, los tres agentes, armado y envío de prueba — hasta la Fase 6 cerrada. Para el estado real, `roadmap.md` es la fuente viva (y tampoco su propio header está al día: dice "última actualización 08/09" pero tiene contenido del 09/09).
- **No está claro si el barrido principal corre solo hoy.** La inspección en vivo encontró el cron del recolector de feeds "deshabilitado a propósito" por defecto en el nodo; el roadmap registra que ese mismo cron **se encendió el 07/09** tras tres días apagado. Puede que ambas cosas sean ciertas en momentos distintos (se construye apagado, se enciende como paso operativo separado) — vale confirmarlo mirando directamente el estado del nodo de cron en n8n antes de asumir que la recolección está corriendo sola.
- **El agente auditor (A3) no existe como subworkflow propio**, a diferencia de lo que describe la arquitectura del design-doc (que lista `sub/agent-A3` con estado "pendiente" en su tabla de piezas). Su lógica se implementó directamente en funciones SQL llamadas desde el armado.
- **Ningún workflow v4 puede avisar hacia afuera todavía.** Tanto el aviso de Slack como el de error tienen su nodo de salida construido pero deshabilitado a propósito — toda la observabilidad de hoy es "hay que ir a mirar" (tablas de errores, la función de salud, el ledger), no push. Coherente con que el pipeline entero sigue en modo de prueba, pero es un estado a tener presente si algo falla en producción real antes del cutover.

---

## 6. Pendientes abiertos

- **Golden completo sin correr:** falta ejecutar un cliente entero y comparar todas sus decisiones (no solo si la nota está presente) contra la v3, antes de cualquier cutover.
- **Descripciones faltantes (§4.6):** renderizar la página en vez de leer HTML crudo para los sitios que arman el cuerpo con JavaScript.
- **HTML del clipping (el mail en sí) sin construir en v4** — hoy ese paso lo sigue haciendo la v3; falta también encadenar "guardar primero, mandar leyendo lo guardado" en el flujo real.
- **Medios monitoreados que todavía no abren:** un resto que necesita revisión manual de sitemaps vacíos o no tiene solución de scraping conocida.
- **Fase 0 (higiene) sigue siendo deuda real, no historia vieja:** las API keys de la v3 en texto plano siguen expuestas; la valorización de la v3 en producción sigue rota (solo se aplicó el fix del lado de la v4); hay corridas duplicadas en la cuenta compartida sin apagar.
- **Seguridad del schema de prueba:** sigue sin RLS, legible y vaciable con la clave pública — deuda marcada como la más grande del proyecto, pospuesta sin fecha.
- **Dashboard (Fase 7):** ningún ítem construido todavía.
- **Costo de Bright Data:** falta revisar el impacto real de las fuentes que ahora salen por ahí, y decidir si baja de frecuencia en vez de mantenerlo full.
- **Tope de gasto de LLM y precios:** siguen marcados como provisorios / sin verificar contra la lista de precios real.
- **Dónde vive en producción el proxy de transporte que hoy corre en un proyecto de prueba.**

---

## 7. Glosario

| Término | Qué es |
|---|---|
| **Fuente** | Una puerta de entrada a un medio: dominio × sección. La ingesta recorre fuentes, no dominios. |
| **Transporte** | Por dónde se sale a internet para pedir una fuente: directo, proxy propio, proxy en la nube, IP residencial de pago. Independiente del formato. |
| **Formato / método de extracción** | Qué se le pide a la fuente: `feed` (RSS/Atom/sitemap) o `html` (portada sin feed, se extraen notas del HTML crudo). |
| **Escalera** | Probar los transportes en orden hasta el primero que trae notas; solo escala ante bloqueo/caída/timeout, nunca ante "sin novedades". |
| **Barrido** | Una pasada del recolector compartido por todo el catálogo. |
| **Pool del día** | Las notas que juntaron los barridos del día, compartidas por los cuatro clientes — cada armado lo filtra por sus propias suscripciones. |
| **URL canónica** | Forma única de una URL tras desenvolver redirectores y sacar parámetros de rastreo, conservando el identificador real del artículo. Base de todo el dedup. |
| **Fecha confiable** | Fecha que viene del feed, de datos estructurados o de metadatos del sitio. Si no hay ninguna, la nota no se descarta por antigüedad y tampoco se le inventa la fecha de hoy. |
| **Compuerta** | Regla determinística de filtrado: entra sí o sí / no entra nunca / puntúa. Nunca decide sobre el tema de la nota, solo sobre hechos (dominio, fecha, idioma). |
| **Nivel de salida (0-3)** | Cuánto se degradó el clipping de un día. 0 = completo y auditado; 3 = se reenvía el de ayer, marcado como tal. |
| **Golden** | La comparación de que la v4 decide igual que la v3 sobre los mismos datos, antes de reemplazar nada. |
| **Cutover** | El momento en que un cliente pasa de la v3 a la v4. Diseñado para ser reversible en dos clicks. |
| **Modo de prueba** | El pipeline entero puede correr contra un schema separado y mandar mail solo a destinatarios internos, sin tocar datos ni clientes reales. |

---

*Documento generado el 2026-09-10 a partir de `roadmap.md`, `design-doc.md` y la inspección directa de la instancia n8n `n8n-ketchum`. No reemplaza a esas fuentes — si algo cambia en el código, actualizar acá también.*
