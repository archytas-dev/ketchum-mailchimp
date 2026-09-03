# Roadmap de construcción · Pipeline v4 de Clipping

Cómo se reemplaza, por fases, la generación diaria del clipping de los cuatro clientes por una arquitectura nueva de ingesta y filtrado, sin interrumpir el envío que sale hoy.

**Base:** especificación técnica del pipeline v4 · análisis de los 601 reportes de calidad del cliente (tabla `reportes`, ventana de 3 semanas) · relevamiento de la instancia de n8n y del esquema de Supabase (`banlcbewinpjtudzdzhm`).
**Estado:** propuesta · **Instancia destino:** `ketchum-n8n` (instancia dedicada).

---

## Índice

1. [Punto de partida](#1-punto-de-partida)
2. [Decisiones de enfoque](#2-decisiones-de-enfoque)
3. [Aislamiento: no tocar lo que sale hoy](#3-aislamiento-no-tocar-lo-que-sale-hoy)
4. [Descomposición: subworkflows y funciones](#4-descomposición-subworkflows-y-funciones)
5. [Trackeo](#5-trackeo)
6. [Las fases](#6-las-fases)
7. [Camino crítico](#7-camino-crítico)
8. [Riesgos y gates](#8-riesgos-y-gates)
9. [Glosario](#9-glosario)

---

## 1. Punto de partida

El clipping sale los siete días de la semana para los cuatro clientes. Todo lo que se agregue tiene que convivir con un envío diario que no se detiene.

Los **601 reportes de calidad** del cliente (3 semanas) agrupados por causa raíz — la forma importa más que el decimal, los números salen de una clasificación por palabra clave sobre la descripción:

| Grupo | Reportes (abiertos) | Causa raíz | Pieza v4 que lo resuelve | Fase |
|---|---|---|---|---|
| **No relevante** ("no va", "no menciona competencia") | ~191 (170) | La IA filtra sin criterio estable; las reglas viven como JavaScript repartido en 3 nodos × 4 workflows, con contenido distinto entre clientes | Compuerta "puntúa" + juez (A2) con prompt de cliente versionado | 4, 5 |
| **No entró** (`falta_nota` con URL) | ~168 (129) | Fuente inalcanzable desde nuestra IP (el fetch directo falla el 94%); el dominio no está desglosado por sección; la nota se descarta por no tener fecha confiable | Escalera de transporte con proxies propios + `medios_fuentes` + no descartar sin fecha confiable + descubridor (A0) | 2, 3, 4 |
| **Sección incorrecta** | ~59 (52) | El clasificador se queda con la primera palabra clave que matchea (un término administrativo, una marca de competencia) | El juez decide la sección + tabla de secciones + prompt de cliente | 5, 7 |
| **Formato** (sin descripción / título con el link / sin fecha / página caída) | ~73 (68) | No hay paso que complete lo que falta ni auditor del clipping ya armado | Completador (A1) + auditor (A3) con chequeos duros que sacan la nota sin frenar el envío | 5, 6 |
| **Fuente extranjera** (dominio de otro país, edición de otro país) | ~39 (32) | Las URLs que llegan por redirector no se decodifican → el chequeo geográfico mira el redirector, no el dominio real; además la blocklist es distinta por cliente | Compuerta "no entra nunca" sobre la URL canónica ya resuelta + reglas globales | 1, 4 |
| **Vieja / repetida** ("ya la enviamos", "se repite hace meses") | ~34 (26) | Dos normalizadores de URL con reglas distintas en el mismo proceso; se borra todo el query string; el historial está contaminado con URLs de redirector sin desenvolver; el mail no deduplica | URL canónica única + fecha confiable + limpieza del historial antes de migrar | 0, 1, 4 |
| **Exclusiva que no entró** | ~13 (11) | No hay compuerta que proteja lo que el cliente eligió. En una semana la IA descartó 262 notas de dos fuentes de nicho cargadas por el cliente | Compuerta "entra sí o sí" + repesca del auditor + aviso suelto de exclusivas | 4, 5, 6 |
| **Otro** (volumen: "salieron 50, el 90% no va"; bugs de dashboard) | ~18 (18) | El embudo de la IA es demasiado ancho; bugs puntuales de precarga y de resumen | La IA ve 20× menos + umbral de volumen por día de semana + fixes de dashboard | 4, 7 |

**Los dos principios de fondo:**

1. **A la hora del envío no se sale a buscar nada.** El clipping ya está decidido, verificado y armado. Lo único que pasa a esa hora es que se manda.
2. **El envío nunca se detiene.** Puede salir peor, nunca puede no salir: una etapa que falla no frena el tren, lo baja de categoría.

---

## 2. Decisiones de enfoque

1. **Alcance entrelazado.** Las mismas fases cubren el pipeline de n8n, el modelo de datos en Supabase y las pantallas nuevas del dashboard. Las piezas de "por qué no entró una nota" y de valorización no sirven sin interfaz.
2. **La v4 reemplaza a la v3 sin migrarla primero.** La v3 sigue corriendo en la cuenta n8n compartida hasta que la v4 la reemplace, cliente por cliente. No se termina de mover la v3 a la instancia dedicada; la v4 se construye ahí desde cero y el golden compara contra la salida real de la v3.
3. **Granularidad híbrida.** La lógica pura (sin entrada/salida) vive en funciones de Postgres: una definición para los cuatro clientes, testeable con el golden. La entrada/salida y la orquestación viven en subworkflows de n8n con contrato de entrada/salida fijo y traza de ejecución propia.
4. **Trackeo con ledger en Supabase.** `pipeline_runs` + `stage_events` + RPC `log_stage()`, un Error Workflow global, y la tabla de descartes para el detalle nota por nota. Sin tracing externo por ahora: el costo de IA es marginal (≈ USD 6/mes) y no es donde está el problema.
5. **Rama aislada.** Todo el trabajo de v4 (migraciones, código del dashboard, JSON de workflows) vive en una rama de feature. No se mergea a la rama principal salvo por fase cerrada y revisada por un segundo.
6. **Un recolector por cliente, no uno compartido.** Cada cliente tiene su propio recorrido de medios (cuatro en total), reusando los mismos subworkflows-ladrillo con parámetros distintos: su lista de medios, sus palabras clave, su horario. Se descartó el recolector único por riesgo de que una corrida de ~1.800 medios agote recursos y se caiga; una corrida por cliente es de unos cientos de medios, más chica y aislable. Los ladrillos y las funciones de decisión **siguen siendo compartidos** — lo que se separa es la orquestación.
7. **Barrido cada ~3 horas, no tres pasadas nocturnas.** El recolector de cada cliente corre 08:00 · 11:00 · 14:00 · 17:00 · 20:00 · 23:00 · 02:00 · 05:00 y una última a las 06:30, justo antes de los envíos. Motivo: hay medios que rotan sus notas a lo largo del día.
8. **Deduplicación al guardar.** En cada barrido, una nota cuya URL canónica ya está en el pool del día se ignora — se conserva la que ya estaba. Solo se guardan URLs nuevas. Así no se acumula ruido ni en la base ni en el mail. Es un filtro distinto del que compara contra lo ya enviado al cliente en días anteriores; los dos se aplican.
9. **Schema de prueba: se reusa y se asegura el que ya existe.** Ya hay un schema de pruebas con las tablas clonadas de producción, y el modo de prueba de la v3 ya le apunta. En vez de crear uno nuevo, se le activa el control de acceso por fila, se le quitan al rol anónimo los permisos peligrosos (borrar / vaciar tablas) y se lo sincroniza con la estructura actual de producción. El pipeline escribe ahí cuando arranca por botón (prueba) y en producción cuando arranca por cron.

---

## 3. Aislamiento: no tocar lo que sale hoy

Los frentes por donde se puede contaminar producción, y la guarda de cada uno.

| Frente | Riesgo | Guarda |
|---|---|---|
| **Dashboard** (Vercel) | Un cambio de ruta, componente o query rompe la herramienta que el cliente usa todos los días | Todo en la rama de feature. Nada a la rama principal hasta fase cerrada y revisada. Las pantallas nuevas se **agregan**, no reemplazan. Revisión por deploy preview, nunca push directo. |
| **Supabase `public`** | Un `ALTER` / `DROP` o una función reescrita rompe la v3 que le llega al cliente | Todo lo nuevo se crea **al lado**: tablas nuevas, funciones con nombre nuevo. Las funciones que la v3 usa no se tocan hasta el cutover. Migraciones reversibles. |
| **Schema de prueba** | El schema `test` actual no tiene control de acceso por fila y deja al rol anónimo borrar tablas enteras | Se reusa ese mismo schema, asegurándolo: control de acceso por fila + revocar los permisos peligrosos del rol anónimo + sincronizarlo con la estructura de producción (Fase 3). Se cierra además el backup congelado, que tiene el mismo problema. |
| **n8n** | Un workflow nuevo activo pisa la corrida real | La v4 entera en la instancia dedicada, con los clippings v3 importados inactivos. La producción real sigue en la cuenta compartida, intacta. Ningún workflow nuevo se activa sin golden y staging. |
| **El mail al cliente** | Una corrida de prueba manda un clipping incompleto, o quema las notas del día | El nodo de envío tira excepción si la corrida no es real. En modo ensayo el mail va a una casilla interna con banner, y **no se escribe el historial anti-repetición** → la corrida real trae las mismas notas como si nunca se hubiera probado. |
| **Métricas del cliente** | Las pruebas inflan promedios y umbrales aprendidos | El modo ensayo no cuenta en `run_stats` ni en los umbrales. |
| **Cuenta n8n compartida** | La higiene de la Fase 0 toca flujos en vuelo | Los únicos cambios que la tocan (apagar corridas duplicadas, rotar una credencial) se coordinan con el responsable de esa cuenta antes de ejecutarlos y **no son parte de construir la v4** — son higiene previa. |

**La regla:** hasta el primer cutover, la construcción de la v4 puede romper todo lo que quiera sin que el cliente se entere. El primer momento en que la v4 toca algo que el cliente ve es el cutover de **un** cliente, y ese cutover es reversible en dos clicks.

---

## 4. Descomposición: subworkflows y funciones

**Regla:** un subworkflow por cada responsabilidad que se quiera ver fallar por separado en la lista de ejecuciones. La lógica pura va a función SQL — una sola definición para los cuatro clientes, testeable con el golden.

### Subworkflows de n8n — contrato fijo, traza propia, reutilizables entre los cuatro clientes

| Subworkflow | Entrada | Salida | Lo usa |
|---|---|---|---|
| `sub/fetch-source` | `{fuente_id, url, formato, transporte}` | `{items[], diagnostico, http_status, con_fecha, ms}` | recolector, escalera, descubridor, medición |
| `sub/fetch-escalera` | `{fuente_id, dominio_norm, url, formato}` | `{transporte_ganador, diagnostico, articulos, items[]}` | recolector, descubridor, medición |
| `sub/open-article` | `{url, transporte}` | `{html, texto, og, jsonld, status}` | A1 |
| `sub/llm-call` | `{prompt, schema, modelo, max_tokens, run_id, stage}` | `{data, tokens, costo, ms}` + escribe `stage_events` | A1, A2, A3 |
| `sub/slack-notify` | `{canal, nivel, titulo, cuerpo, acciones[]}` | `{ok}` | todos |
| `sub/send-email` | `{clipping_id, destinatarios, es_real}` | `{enviado_at}` — excepción si no es real | armado por cliente |
| `sub/agent-A1` (completador) | lote de candidatas incompletas | candidatas completas + `completado[]` | armado por cliente |
| `sub/agent-A2` (juez) | lote de 12 + prompt de cliente + secciones | veredicto por nota | armado por cliente |
| `sub/agent-A3` (auditor) | clipping armado entero | `{notas_a_quitar[], notas_a_repescar[], hallazgos[]}` | armado por cliente |

### Orquestadores top-level — uno cada uno, no reutilizables

| Workflow | Trigger | Qué hace |
|---|---|---|
| `wf/descubridor` (A0) | diario, fuera de la ventana de envío | descubre formato × transporte por dominio → `medios_estrategia` |
| `wf/recolector-cliente` | 1 por cliente · cada ~3 h (08:00 … 05:00) + última 06:30 | recorre las fuentes de ese cliente, llama `sub/fetch-escalera`, deduplica por URL canónica → `candidatas_raw` |
| `wf/armado-cliente` | 1 por cliente, unos minutos antes de su corte | compuertas → A1 → A2 → A3 → armado → nivel → guardar → mail |
| `wf/salud` | post-envío | cobertura, fuentes mudas, volumen esperado por día de la semana |
| `wf/error-handler` | Error Workflow de todos | consolida el aviso y escribe el fallo en `stage_events` |

### Funciones de Postgres — una definición, cuatro clientes

`url_canonica()` · `resolver_fecha()` (cascada, nunca inventa) · `es_repetida()` · `normalizar_y_compuertas()` · `tier_norm()` + `tier_alias` · `armar_clipping()` · `decidir_nivel()` · `log_stage()` (RPC del ledger).

---

## 5. Trackeo

Hoy "perder datos" y "un día tranquilo" se ven exactamente igual: casi todos los nodos capturan el error y devuelven una lista vacía. El ledger invierte eso — cada etapa deja rastro al entrar y al salir.

```
pipeline_runs                 una fila por corrida × cliente × modo
  id · client_id · fecha · modo(prod|ensayo) · trigger
  arranco_at · termino_at · nivel_salida · estado

stage_events                  una fila por etapa, al entrar y al salir
  run_id · stage · fase(in|out) · ts
  n_in · n_out · ms · status(ok|degradado|error) · error_txt
  tokens · costo_usd · modelo      (solo etapas de agente)

descartes (extiende notas_descartadas)   una fila por nota que no entró
  candidata_id · run_id · etapa · regla_id
  valor_que_matcheo · puntaje_final · explicacion · recuperable
```

- Cada subworkflow llama `log_stage()` al entrar y al salir — es una llamada HTTP a una RPC, no un Execute Workflow, así que no infla la lista de ejecuciones.
- El Error Workflow global consolida: un mensaje por corrida, no uno por fuente caída.
- Las pantallas del dashboard leen de estas tablas. "¿Por qué no entró esta nota?" es un `select` sobre la tabla de descartes.
- Ningún nodo nuevo captura el error sin registrar el motivo en `stage_events`.

---

## 6. Las fases

En orden de dependencia. Cada una es reversible y no toca lo que el cliente usa hoy hasta la Fase 8.

### Fase 0 · Higiene y base — sin arquitectura nueva

Limpia la deuda que, si no, ensucia todo lo que viene, sobre todo la medición del gate de la Fase 2.

| # | Cambio | Por qué ahora | Riesgo |
|---|---|---|---|
| 0.1 | Relevar y apagar las corridas duplicadas en la cuenta compartida. Cada cliente dispara hoy varios pipelines completos al mismo minuto: la versión vieja (que manda a una casilla interna) más dos v3, una con el envío apagado. | Se le pega varias veces a cada fuente desde la misma IP en el mismo minuto → parte del bloqueo puede ser autoinfligido. Medir cobertura con esa carga puesta da un número falso. | Workflows activos de producción. |
| 0.2 | Re-medir el bloqueo de fuentes tras apagar los duplicados (unos días de `run_stats`). | Ajusta el alcance de la Fase 2: si "sin resultado" baja fuerte, el problema de transporte es más chico de lo estimado. | Solo lectura. |
| 0.3 | Rotar la API key de scraping expuesta en texto plano en el nodo de configuración de los cuatro clippings. Actualizar los cuatro en la misma sesión. | Credencial expuesta = alguien puede quemar la cuota paga. | Los cuatro flujos fallan en el intervalo entre rotar y actualizar. |
| 0.4 | Quick win de valorización: función `tier_norm()` aplicada de los dos lados del cruce nombre↔tier. Medido: la cobertura de ad value sube de ~16% a ~36%, sin trabajo del cliente. | Es plata que el cliente deja sobre la mesa todos los días. No depende de la v4. | Único item que toca una función que la v3 usa; es aditivo, va con revisión de un segundo y corrida de TEST. |
| 0.5 | Limpiar el historial anti-repetición: script único que desenvuelve las URLs de redirector guardadas crudas y colapsa duplicados. Backup de la tabla antes. | Una URL de redirector cruda nunca vuelve a matchear la real → la nota se re-envía para siempre. La Fase 4 hereda este historial. | Bajo — tabla de soporte, no la ve el cliente. |
| 0.6 | Asegurar el schema `test` (control de acceso por fila + revocar del rol anónimo el borrado / vaciado de tablas) **sin romperlo** — la v3 lo usa en modo prueba y la v4 lo va a reusar. Cerrar aparte el backup congelado, que tiene el mismo agujero y no lo usa nadie. Antes: verificar cómo escribe la v3 en `test`. | Bug de seguridad real: cualquiera con la clave pública del front puede leerlo o vaciarlo. | Romper el modo TEST de la v3 si no se verifica primero. |
| 0.7 | Corregir el `client_id` de escritura de la v3 (cada cliente tiene un par vivo/histórico) y apagar el clipping duplicado de uno de los clientes. | Datos que aterrizan en el identificador equivocado no los ve nadie. | Bajo, previa verificación. |

**Salida:** números limpios para medir la Fase 2, deuda de seguridad cerrada, y la valorización arreglada en producción — sin escribir una línea de v4.

**Tickets sugeridos:**
- **[F0.1]** Relevar y apagar corridas duplicadas de clipping — inventario por cliente + apagado de los v3 viejos + decisión sobre las versiones viejas con el responsable de la cuenta.
- **[F0.2]** Re-medir bloqueo de fuentes — comparar `run_stats` antes/después.
- **[F0.3]** Rotar la API key de scraping expuesta y actualizar los cuatro clippings.
- **[F0.4]** `tier_norm()` de los dos lados del cruce de valorización (+revisión +TEST).
- **[F0.5]** Script de limpieza del historial anti-repetición.
- **[F0.6]** Asegurar el schema `test` (sin romper el modo prueba de la v3) + cerrar el backup congelado.
- **[F0.7]** Corregir `client_id` de la v3 y apagar el clipping duplicado.

### Fase 1 · Modelo de datos — nuevo, al lado, vacío

- Modelo de medios en tres tablas: catálogo (un dominio, global), fuentes (una por sección) y suscripción (una por cliente × fuente), más la estrategia de transporte aprendida. Se pueblan leyendo la tabla actual de medios y se comparan dominio por dominio.
- Reglas de filtrado como datos, prompts de cliente versionados, log de intentos, pool crudo de candidatas.
- Ledger: corridas y eventos de etapa, con las RPC que lo alimentan.
- Funciones puras: normalización de nombres de medio (final); URL canónica, cascada de fecha y chequeo de repetida (primera versión, se endurecen en la Fase 4).

**Salida:** todo el modelo listo y vacío. Las tablas viejas siguen siendo la verdad. Reversible.

**Tickets sugeridos:**
- **[F1.1]** Migraciones del modelo de medios (catálogo / fuentes / suscripción / estrategia).
- **[F1.2]** Migraciones de reglas de filtrado + prompts de cliente versionados.
- **[F1.3]** Migraciones de ingesta (log de intentos + candidatas crudas).
- **[F1.4]** Extender la tabla de descartes (aditivo, verificado que no rompe la v3).
- **[F1.5]** Ledger: corridas + eventos de etapa + RPC.
- **[F1.6]** Funciones puras + tabla de alias de medio.
- **[F1.7]** Control de acceso por fila + grants de todo lo nuevo.
- **[F1.8]** Poblar el catálogo desde la tabla actual de medios — comparación dominio a dominio, resolución manual de los dominios con método distinto por cliente, limpieza de filas basura.
- **[F1.9]** Aplicar las migraciones (smoke-test, revisión de advisors).

*(El schema de prueba ya no es un ticket de la Fase 1: en vez de crear uno nuevo se reusa y asegura el que existe — pasa a la Fase 3.)*

### Fase 2 · Transporte y cobertura — gate de decisión

- `sub/fetch-source` con contrato fijo y switch de transporte: directo → proxy propio A → proxy propio B → renderizador → IP residencial. Escribe el log de intentos. Los dos proxies ya están deployados y con credenciales cargadas.
- `wf/descubridor` (A0): descubre formato × transporte por dominio.
- **Workflow de medición aislado:** recorre todos los dominios una noche, no manda mail ni escribe tablas de cliente. Produce el número que decide todo: cuántas de las fuentes que hoy nunca se visitan se recuperan.

**Gate:** si la medición recupera pocas fuentes, se replantea el alcance de la v4 antes de seguir. El workflow de medición necesita autorización explícita para crearse.

**Tickets sugeridos:**
- **[F2.1]** `sub/fetch-source` con switch de transporte y escritura del log.
- **[F2.2]** `wf/descubridor` (A0) — descubrimiento de estrategia por dominio.
- **[F2.3]** Workflow de medición aislado (requiere autorización).
- **[F2.4]** Decisión de gate con el número de cobertura recuperable en mano.

### Fase 3 · Recolector por cliente + schema de prueba

- **Sincronizar el schema de prueba con producción:** agregarle las tablas nuevas de la v4 para que quede espejo de `public`. (El asegurado —control de acceso, revocar permisos peligrosos— ya se hizo en la Fase 0.)
- **`wf/recolector-cliente`:** un workflow por cliente. Corre cada ~3 h (08:00 … 05:00) y una última a las 06:30. Recorre las fuentes de *ese* cliente, cada una por `sub/fetch-escalera`, con control de concurrencia y de lote.
- **Deduplicación al guardar:** una nota cuya URL canónica ya está en el pool del día se ignora; solo entran URLs nuevas. Cada barrido suma lo nuevo, no repite lo que ya tenía.
- Cierre de cobertura al terminar cada barrido + aviso si baja del umbral.
- Los cuatro recolectores usan los mismos subworkflows-ladrillo (`sub/fetch-source`, `sub/fetch-escalera`); cambian los parámetros por cliente (medios, palabras clave, horario).

**Salida:** el pool de candidatas de cada cliente se llena a lo largo del día en el schema de prueba, en paralelo a su v3, sin reemplazar nada.

**Tickets sugeridos:**
- **[F3.1]** Sincronizar el schema de prueba con la estructura actual de producción (agregarle las tablas nuevas de la v4).
- **[F3.2]** `wf/recolector-cliente` — plantilla del recolector (parametrizada por cliente).
- **[F3.3]** Deduplicación al guardar por URL canónica.
- **[F3.4]** Instanciar el recolector para los cuatro clientes con sus parámetros y horarios.
- **[F3.5]** Cierre de cobertura + aviso por barrido.

### Fase 4 · Normalización + compuertas

- Completar `url_canonica` con el decode de los redirectores del agregador de noticias.
- `normalizar_y_compuertas()`: normaliza, resuelve fecha por cascada (nunca inventa, nunca pone la de hoy), deduplica con una sola regla y aplica las tres compuertas ("entra sí o sí" / "no entra nunca" / "puntúa").
- Poblar las reglas de filtrado traduciendo el JavaScript de los cuatro workflows a filas, una sola vez.
- Cada descarte se escribe con la regla exacta y el valor que la disparó.
- Reconstruir el historial anti-repetición con la URL canónica.

**Cierra:** el grueso de "fuente extranjera", "vieja / repetida", la mitad de "no relevante", y — con la compuerta dura — "exclusiva que no entró".

**Tickets sugeridos:**
- **[F4.1]** `url_canonica` — decode de redirectores del agregador.
- **[F4.2]** `normalizar_y_compuertas()`.
- **[F4.3]** Poblar reglas de filtrado desde el JavaScript actual.
- **[F4.4]** Escritura de descartes con regla + valor.
- **[F4.5]** Reconstruir el historial anti-repetición con la URL canónica.

### Fase 5 · Los agentes

- `sub/llm-call` compartido: llamada al modelo + un retry + backoff ante límite de tasa + tope de tokens por cliente/día + registro de tokens y costo.
- `sub/agent-A1` (completador): detecta qué información falta y la busca; limpia HTML de las descripciones, corta el sufijo del medio en los títulos, reemplaza la descripción cuando corresponde a otra nota.
- `sub/agent-A2` (juez): veredicto por nota con el prompt del cliente y la tabla de secciones, en lotes, con escalado a modelo grande ante duda. **No puede descartar** una nota de fuente prioritaria o que menciona una marca del cliente — solo decide la sección.
- `sub/agent-A3` (auditor): ve el clipping entero; chequeos duros que sacan la nota culpable sin frenar el envío, chequeos blandos que solo avisan, y repesca de descartes dudosos.

**Cierra:** "no relevante" (juez estable), "sección incorrecta", "formato" (A1 completa, A3 audita) y el ruido de volumen.

**Tickets sugeridos:**
- **[F5.1]** `sub/llm-call` — llamada + retry + backoff + tope de tokens + registro de costo.
- **[F5.2]** `sub/open-article` — abre una nota por la escalera de transporte.
- **[F5.3]** `sub/agent-A1` (completador).
- **[F5.4]** `sub/agent-A2` (juez) con la restricción de prioritarios/marca.
- **[F5.5]** `sub/agent-A3` (auditor) con chequeos duros, blandos y repesca.

### Fase 6 · Armado, salida y degradación

- `armar_clipping()`: orden de secciones, valorización, resumen. Determinístico (necesario para el golden).
- `decidir_nivel()`: nodo determinístico que elige el nivel de salida (0 a 3) según qué etapas anduvieron. No puede devolver "no salgo".
- Guardado en la plataforma **primero**, marca de listo, después el mail leyendo lo guardado.
- `sub/send-email` con guarda dura. Misma guarda en el nodo que escribe el historial anti-repetición.
- `sub/slack-notify` con el formato consolidado.
- Idempotencia: re-ejecutar el mismo día produce exactamente el mismo clipping y un solo mail.
- `wf/salud`: cobertura, fuentes mudas, volumen esperado **por día de la semana** (el volumen baja fuerte los fines de semana; un umbral global daría falsa alarma todos los domingos).

**Cierra:** "formato: página caída" (el auditor muestrea links) y el silencio de los días rotos (hubo un día con cero notas enviadas y se supo semanas después).

**Tickets sugeridos:**
- **[F6.1]** `armar_clipping()` determinístico.
- **[F6.2]** `decidir_nivel()` — escalera de degradación 0–3.
- **[F6.3]** `sub/send-email` con guarda dura.
- **[F6.4]** `sub/slack-notify` consolidado.
- **[F6.5]** Idempotencia (upsert por cliente/fecha + bandera de enviado).
- **[F6.6]** `wf/salud` con umbrales por día de semana.
- **[F6.7]** `wf/error-handler` global.

### Fase 7 · Dashboard

Puede arrancar en paralelo apenas existan las tablas de descartes y de reglas (fin de Fase 1); se completa contra las Fases 5 y 6.

- **"Notas que no entraron"** sobre la pestaña de actividad: fuente, motivo, regla, valor que matcheó y botón para subirla. Al subir, la regla suma un error; a los tres errores queda marcada para revisar.
- **"Reglas de filtrado":** cuánto descartó, cuántos errores, estado, por cliente y global; alta de regla y propuestas.
- **"Salud de fuentes":** notas reales de 30 días (no un contador que nunca se escribió), estado y transporte; aviso cuando una fuente lleva 14 días en cero.
- **"Medios sin valorizar":** ordenados por volumen, asignación de tier en la misma pantalla, aviso semanal con los de mayor volumen.
- **Sonda de alta inmediata:** el cliente pega una URL y ve tres titulares reales de esa fuente en menos de un minuto, antes de guardar. Nunca un alta muda.
- **Historial de configuración:** toda alta, baja, bloqueo y cambio de tier queda registrado con fecha de vigencia; el cambio se aplica en el próximo clipping, nunca sobre uno enviado.
- **Fixes puntuales:** el alcance no aparece en la precarga de exclusivas; el resumen de IA toma solo la primera nota.

**Cierra:** las cientos de correcciones que hoy no alimentan nada. El ticket que creó la pestaña de reportes pedía que el equipo técnico revisara, corrigiera y ajustara la configuración base para que no se repita — esa segunda mitad nunca se construyó.

**Tickets sugeridos:**
- **[F7.1]** Pantalla "Notas que no entraron" + contador de errores por regla.
- **[F7.2]** Pantalla "Reglas de filtrado".
- **[F7.3]** Pantalla "Salud de fuentes".
- **[F7.4]** Pantalla "Medios sin valorizar".
- **[F7.5]** Sonda de alta inmediata.
- **[F7.6]** Historial de configuración con fecha de vigencia.
- **[F7.7]** Fixes puntuales (precarga de exclusivas, resumen de IA).

### Fase 8 · Golden + primer cutover

- **Golden:** la v4 decide idéntico sobre los mismos datos que la v3, el mismo día, con las mismas notas de entrada y el mismo clipping de salida. Cada diferencia se explica antes de avanzar. Es el mismo patrón de golden usado en otros proyectos de clipping.
- **Staging obligatorio:** copia de un día real del cliente piloto.
- **Cutover:** se activa el `wf/armado-cliente` del piloto en la instancia dedicada; su v3 en la cuenta compartida se desactiva, no se borra, durante 30 días.
- **Rollback definido antes de arrancar:** dos días seguidos con volumen fuera de banda, o una queja del cliente, disparan el retorno — desactivar el nuevo, activar el viejo, dos clicks.

**Orden de pilotos — piloto Booking, BMS segundo.**

El piloto es **Booking** porque es el clipping más chico y simple (210 fuentes contra 640, 18 palabras clave contra 106, corre en 5 minutos, 20% de descartes determinísticos contra 7%). El golden es más rápido y el error es el más barato: si la arquitectura tiene una falla, se ve en el contexto más limpio.

**BMS va segundo, no cuarto** — es donde más duele (329 reportes, la mayoría "no entró"). Pero el grueso de ese dolor lo arregla la cadena de transporte (Fase 2) y el filtrado (Fase 4), que son **piezas compartidas**, y el recolector de cada cliente se construye en la misma Fase 3. Los números de BMS mejoran en el schema de prueba desde la Fase 3, sin haber cortado nada. Si al terminar la Fase 6 esos números están bien y el golden de Booking sale limpio, los dos cutovers pueden ir casi juntos.

**Tickets sugeridos:**
- **[F8.1]** Arnés de golden — correr v4 y v3 sobre los mismos datos y diff de salida.
- **[F8.2]** Staging del piloto con un día real.
- **[F8.3]** Cutover de Booking (activar v4, desactivar su v3).
- **[F8.4]** Definir disparador de rollback y monitoreo post-cutover.

### Fase 9 · Replicar al resto

- Mismo pipeline. Cambia el identificador de cliente, el prompt, las suscripciones y el horario. Un cliente nuevo es una fila en una tabla y un horario.
- Orden: **BMS** (donde más duele) → Mars → MSD. Se confirma con los números de ensayo de la Fase 6.
- Cada cutover desactiva la v3 de ese cliente. A los 30 días sin incidentes, se borran los workflows viejos y el modelo de medios con identificador de cliente.

**Tickets sugeridos:**
- **[F9.1]** Cutover de BMS.
- **[F9.2]** Cutover de Mars.
- **[F9.3]** Cutover de MSD.
- **[F9.4]** Baja de la v3 y del modelo de medios viejo, pasados los 30 días.

---

## 7. Camino crítico

`Fase 0` → `Fase 1` → **`Fase 2` (gate)** → `Fase 3` → `Fase 4` → `Fase 5` → `Fase 6` → `Fase 8` (piloto) → `Fase 9`

La **Fase 7** (dashboard) corre en paralelo: arranca apenas existan las tablas de descartes y de reglas, y se completa contra las Fases 5 y 6.

Desde la Fase 3, el recolector de cada cliente corre en el schema de prueba en paralelo a su v3 — los números mejoran para los cuatro antes de cualquier cutover.

---

## 8. Riesgos y gates

- **Gate de la Fase 2:** la medición de cobertura recuperable. Si recupera poco, la v4 pierde su justificación principal — hay que saberlo antes de construir la ingesta.
- **Flujos en vuelo:** nada de la Fase 0 que toque los flujos de la cuenta compartida se ejecuta sin coordinarlo con el responsable de esa cuenta.
- **Zonas horarias:** se resuelve antes de escribir una línea. Todo se guarda en UTC y se decide en hora local; una fecha sin hora nunca se compara contra un corte horario.
- **Recolector por cliente:** más workflows para mantener (cuatro recolectores en vez de uno), pero cada corrida es chica y el crash de una no arrastra a las otras. Los ladrillos son compartidos, así que un arreglo sigue valiendo para los cuatro.
- **Carga de n8n:** cuatro recolectores × ~9 barridos/día. Vigilar memoria y solapamiento; escalonar los horarios entre clientes si hace falta.
- **Autor ≠ aprobador:** cada fase que promueve a `public` o activa un workflow necesita revisión de un segundo.
- **Fuera de alcance de la v4 y de este roadmap:** las gacetillas, el editor web y la exportación, y los clientes en formato legado.

---

## 9. Glosario

| Término | Qué es |
|---|---|
| **Compuerta** | Regla determinística que decide si una nota entra sí o sí, no entra nunca, o pasa a puntuar. Los descartes duros son sobre la fuente y los hechos (dominio, fecha, idioma), nunca sobre el tema. |
| **Formato vs. transporte** | Formato = qué se le pide a una fuente (feed, sitemap, HTML). Transporte = cómo se llega (directo, proxy propio, renderizador, IP residencial). Son preguntas independientes: una fuente puede tener un feed impecable y ser inalcanzable desde nuestra IP. |
| **URL canónica** | La forma única de una URL tras desenvolver redirectores, sacar parámetros de tracking (conservando el identificador del artículo), y normalizar host y barra final. Base del dedup. |
| **Fecha confiable** | Fecha obtenida del feed, de datos estructurados, de metadatos o de la propia URL. Si no hay ninguna, la nota no se descarta por antigüedad y no se le inventa la fecha de hoy. |
| **Barrido** | Una pasada del recolector de un cliente por todas sus fuentes. Corre cada ~3 h (08:00 … 05:00) y una última a las 06:30, justo antes de los envíos. |
| **Pool del día** | El conjunto de notas que juntaron los barridos de ese día para ese cliente, antes de filtrar. Cada barrido suma solo lo nuevo (URL canónica que no estaba). |
| **Nivel de salida (0–3)** | Cuánto se degradó el clipping. 0 = completo y auditado. 1 = sin auditor o sin valorización. 2 = sin juez (solo filtro determinístico). 3 = sale el de ayer, marcado como tal. |
| **Golden** | Antes de reemplazar nada, la v4 tiene que decidir idénticamente sobre los mismos datos que el flujo actual. Cada diferencia se explica antes de avanzar. |
| **Cutover** | El momento en que un cliente pasa a la v4. Reversible: se desactiva el nuevo y se activa el viejo, que quedó apagado 30 días, no borrado. |
| **Schema de prueba / modo prueba** | El pipeline es el mismo; una perilla al arrancar decide dónde escribe. Cron → schema real, mail al cliente, historial actualizado. Botón → schema de prueba, mail al equipo con cartel, historial intacto. Así probar no quema las notas del día. |
| **Ledger** | Las tablas `pipeline_runs` y `stage_events`: registran cada corrida y cada etapa al entrar y al salir, para que un día roto no se vea igual que un día tranquilo. |

---

*Documento vivo. Se actualiza cuando cambia el plan o cuando una fase cierra. La especificación técnica detallada del pipeline y las notas de implementación de cada fase viven junto a este archivo.*
