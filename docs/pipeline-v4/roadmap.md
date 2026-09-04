# Roadmap · Pipeline v4 de Clipping

El plan de construcción: fases, orden, dependencias y tickets. El **qué y el cómo** (arquitectura, modelo de datos, decisiones, alternativas) están en [`design-doc.md`](./design-doc.md) — este doc no los repite.

**Estado:** en construcción · **Rama:** `feat/pipeline-v4` (fuente de verdad de la v4) · **Última actualización:** 2026-09-04 (descubridor A0 construido y corrido sobre las 442 fuentes rotas; el techo del ~96% no se sostuvo)

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
10. **El proxy no es el plan B, es el camino principal.** Medido: el transporte directo resuelve el 11% de las fuentes; Cloudflare, el 61%. La escalera no es una red de contención para casos raros — es por donde entra la mayoría. Cualquier diseño que asuma "directo salvo excepción" está mal calibrado.
11. **El cuarto escalón (Bright Data, residencial y pago) va solo contra el bloqueo, nunca contra el timeout.** Medido: recupera 31 de 45 bloqueadas (69%) y apenas 3 de 20 con timeout (15%). Y 15 de esas 20 vuelven con error de servidor: son fuentes rotas de verdad, no bloqueadas. Pagar por reintentarlas es tirar plata; van a revisión o baja. *(Medida la escalera completa, el bloqueo casi desaparece como problema: queda **una** fuente bloqueada en 1.260.)*
12. **Las corridas masivas se disparan por webhook, nunca con el botón de n8n.** En ejecución manual n8n retiene todo el set en memoria para mostrarlo en pantalla y el proceso muere con volumen alto; por webhook el mismo trabajo pasa sin problema. Además se corre **por tandas contra una vista de pendientes** (`v4_medicion_pendientes`), que devuelve solo lo que falta medir: si una tanda se corta, lo no medido sigue pendiente y la siguiente lo toma. Nada de "todo o nada".
13. **`transporte` y método de extracción son dos ejes distintos y no van en la misma columna.** `directo` / `cloudflare` / `aws` / `brightdata` dicen *por dónde salgo a internet*. `jina` dice *cómo convierto una página en notas*. La Fase 1 los metió juntos en `medios_estrategia.transporte` porque la v3 los tenía juntos en `medios.metodo`, y la consecuencia es concreta: el Switch de `sub/fetch-source` no tiene rama para `jina`, así que esas fuentes caen en el fallback y se buscan **por directo**, sin URL. Se separan en `transporte` (red) y `metodo_extraccion` (`feed` | `html`), y el camino `html` lo sirve `sub/open-article` de la Fase 5 — no un quinto transporte. Ver el hallazgo de las 168 en la Fase 2.
14. **Al consolidar, el veredicto que vale es el del último escalón, no el del primero.** Cuando ningún transporte funciona, es fácil que la consulta se quede con lo que dijo el intento inicial e ignore lo que dijeron los proxies después. Pasó dos veces el 03/09: una escribió "usá directo" en 270 fuentes que no funcionan, y otra reportó 270 timeouts que en realidad eran fuentes que responden bien. **Regla: ninguna consolidación puede caer por descarte en el primer valor disponible; si no hay respuesta buena, se escribe `NULL` y el motivo.** Aplica a toda la Fase 4 en adelante, no solo a la medición.

---

## 3. Las fases

En orden de dependencia. Cada una es reversible y no toca lo que el cliente usa hoy hasta la Fase 8.

### Fase 0 · Higiene y base — `pendiente`

Limpia la deuda que, si no, ensucia todo lo que viene (sobre todo la medición del gate de la Fase 2). Varios ítems tocan la cuenta compartida → se coordinan con el responsable de esa cuenta.

| # | Cambio | Por qué | Riesgo |
|---|---|---|---|
| 0.1 | Relevar y apagar las corridas duplicadas en la cuenta compartida (cada cliente dispara hoy varios pipelines al mismo minuto). | Le pegamos varias veces a cada fuente desde la misma IP → parte del bloqueo puede ser autoinfligido. Medir con esa carga da un número falso. | Workflows activos de producción. |
| 0.2 | ~~Re-medir el bloqueo de fuentes tras apagar los duplicados.~~ **Sin objeto — se cierra.** | Se escribió cuando creíamos que el bloqueo era el problema. La medición del 03/09 dio **1 fuente bloqueada en 1.260**: no queda nada que re-medir. `F0.1` sigue valiendo, pero por carga, no por bloqueo. | — |
| 0.3 | Rotar **tres** API keys expuestas en texto plano en el nodo de config de los clippings de la v3 (proxy residencial, modelo de lenguaje y lectura de artículos), y pasarlas a Credentials. | Credencial expuesta = alguien puede quemar la cuota paga. Se relevó el 03/09: no es una key, son tres, y una de ellas es de un servicio que se cobra por uso. | Los flujos fallan en el intervalo entre rotar y actualizar. |
| 0.4 | Quick win de valorización: `tier_norm()` de los dos lados del cruce nombre↔tier. Medido: 16% → 36%. | Plata que el cliente deja sobre la mesa todos los días. No depende de la v4. | Único ítem que toca una función de la v3; aditivo, va con revisión + TEST. |
| 0.5 | Limpiar el historial anti-repetición: script único que desenvuelve las URLs de redirector guardadas crudas y colapsa duplicados. | Una URL de redirector cruda nunca vuelve a matchear la real → la nota se re-envía para siempre. La Fase 4 hereda este historial. | Bajo — tabla de soporte. |
| 0.6 | Asegurar el schema `test` (control de acceso por fila + revocar del rol anónimo el borrado) **sin romperlo** — la v3 lo usa y la v4 lo va a reusar. Cerrar aparte el backup congelado. | Bug de seguridad: cualquiera con la clave pública del front puede leerlo o vaciarlo. | Romper el modo TEST de la v3 si no se verifica primero. |
| 0.7 | Corregir el `client_id` de escritura de la v3 (par vivo/histórico) y apagar el clipping duplicado de uno de los clientes. | Datos que aterrizan en el identificador equivocado no los ve nadie. | Bajo, previa verificación. |

**Salida:** números limpios para medir la Fase 2, deuda de seguridad cerrada, valorización arreglada en producción — sin escribir una línea de v4.

**Tickets:** `[F0.1]` relevar+apagar corridas duplicadas · ~~`[F0.2]` re-medir bloqueo~~ (cerrado sin objeto) · `[F0.3]` rotar API key expuesta · `[F0.4]` `tier_norm()` de los dos lados (+revisión +TEST) · `[F0.5]` script de limpieza del historial · `[F0.6]` asegurar `test` + cerrar el backup · `[F0.7]` corregir `client_id` v3 + apagar clipping duplicado.

### Fase 1 · Modelo de datos — `✅ aplicada (03/09)`

- Modelo de medios en tres tablas (catálogo global, fuentes por sección, suscripción por cliente) + estrategia de transporte aprendida. Poblado leyendo la tabla actual de medios.
- Reglas de filtrado como datos, prompts de cliente versionados, log de intentos, pool crudo de candidatas.
- Ledger (corridas + eventos de etapa) con sus RPC.
- Funciones puras: `tier_norm` (final); `url_canonica`, `resolver_fecha`, `es_repetida` (v1, se endurecen en Fase 4).

**Estado:** 11 tablas nuevas (con RLS) + 6 columnas en `notas_descartadas` + 6 funciones, aplicadas a producción. `get_advisors` sin hallazgos nuevos en `public`. Catálogo poblado: 1.542 dominios · 1.542 fuentes · 2.102 suscripciones.

**Tickets:** `[F1.1]`–`[F1.7]` migraciones + RLS ✅ · `[F1.8]` poblar el catálogo ✅ · `[F1.9]` aplicar + advisors ✅.
*(El schema de prueba salió de esta fase — se reusa `test`, se asegura en la Fase 0 y se sincroniza en la Fase 3.)*

### Fase 2 · Transporte y cobertura — `✅ gate pasado (03/09)`

- **`sub/fetch-source`** ✅ — una fuente, un transporte → contrato + `fetch_log`. Probado contra feeds reales.
- **`sub/fetch-escalera`** ✅ — la escalera `directo → cloudflare → aws`, corta en el primero con notas. Probado.
- **Medición de cobertura** ✅ **corrida y consolidada.** Las 1.260 fuentes activas con URL usable, contra los cuatro transportes.
- **`wf/descubridor` (A0)** ✅ — construido y corrido sobre las 442 fuentes rotas (04/09). Encuentra el 35%; el detalle y lo que le hace al techo, más abajo.

**Resultado del gate: entran 960 de 1.260 (76%).** Por transporte ganador:

| Transporte | Dominios | % |
|---|---|---|
| Cloudflare | 774 | 61% |
| Directo | 138 | 11% |
| Bright Data (residencial, pago) | 32 | 3% |
| AWS | 16 | 1% |
| Sin transporte que funcione | 300 | 24% |

**El gate pasa con holgura:** sin escalera entrarían 138 fuentes; con escalera, 960. Multiplica por 7 lo recuperable, así que la capa de transporte de la v4 se justifica sola.

**Y las 300 que no entran no están bloqueadas: en su mayoría responden bien.** Mirando el veredicto del *último* escalón probado (no el del primero):

| Veredicto final | Dominios | ¿Se arregla con transporte? |
|---|---|---|
| Responde, pero el feed viene vacío | 178 | No — hay que encontrar el feed real |
| Responde, pero no es un feed (es HTML) | 76 | No — la URL apunta a otra cosa |
| Servidor caído | 20 | No — está roto |
| No existe (404) | 15 | No — la URL murió |
| Timeout real | 8 | Quizás |
| Rate limit / bloqueado | 3 | Quizás |

**254 de las 300 (85%) responden.** Se entra perfecto; lo que no hay es un feed usable en la URL que tenemos cargada. Genuinamente inalcanzables quedan **46 (4% del total)**, y **bloqueadas de verdad, una sola**.

**Conclusión que reordena las prioridades: el problema de fondo no es el bloqueo, es la configuración de las fuentes.** Sumando estas 254 a las 177 sin URL, hay **442 fuentes (31%) que dependen del descubridor y de ningún proxy**.

> **Corregido el 04/09 — el techo del ~96% era una suposición y no se sostuvo.**
> Ese número asumía que el descubridor le encontraría el recurso correcto a casi todas las 442. Se construyó (`[F2.2]`) y se corrió sobre las 442: **encuentra el 35%.** Ver el resultado abajo.

**Lo aprendido quedó guardado, no solo medido:** `medios_estrategia` tiene, por dominio, el transporte que funciona + fecha de verificación. El recolector de la Fase 3 va derecho al que anda en vez de subir la escalera entera en cada barrido (era el riesgo de recursos que motivó un recolector por cliente). **Convención:** si `transporte` está en `NULL`, no se conoce forma de traer esa fuente — el motivo queda en `ultimo_diagnostico`. Nunca se escribe un transporte que no se verificó.

**Tres hallazgos que corren el foco del problema:**

1. **177 fuentes activas (12%) no tienen URL de feed usable** (143 en `NULL`, 32 en cadena vacía, 2 sin esquema). No es un problema de transporte: a esas no les pega ningún proxy porque no hay adónde pegar. *(Ojo: el filtro `url_feed is not null` no alcanza — las 32 vacías lo pasan, fallan al instante y se cuentan como timeout falso. Hay que filtrar por `url_feed like 'http%'`.)*
2. **254 más responden bien pero su URL no tiene un feed usable** (vacío o directamente HTML). Mismo problema de fondo que el punto 1: la fuente está mal apuntada.
3. **Varias de las recuperadas traen un índice del sitio sin fechas.** Miles de URLs y casi ninguna fecha: sirve para saber que el medio responde, no para armar un clipping del día. Necesitan que se les encuentre el feed real o que se abra la nota para resolver la fecha — A0 y Fase 4.

Los tres apuntan al mismo lado: **la deuda está en cómo están cargadas las fuentes, no en la capa de red.** El descubridor (A0) deja de ser un ítem más de la Fase 2 y pasa a ser la palanca de mayor impacto de todo el roadmap. *(Confirmado el 04/09: lo es. Pero recupera el 35%, no el 100% — ver abajo.)*

**La cobertura no es pareja entre clientes.** Las 1.260 fuentes son el catálogo compartido; cada cliente está suscripto a un subconjunto y su recolector solo recorre el suyo (por eso las suscripciones suman más que el catálogo: muchos medios los comparten varios clientes).

| Cliente | Fuentes propias | Funcionan hoy | Recuperables (mal apuntadas) | Sin URL | Techo teórico |
|---|---|---|---|---|---|
| BMS | 641 | 400 (62%) | 135 | 82 | ~96% |
| MSD | 598 | 397 (66%) | 87 | 98 | ~97% |
| Mars | 465 | 325 (70%) | 89 | 44 | ~99% |
| Booking | 208 | 155 (75%) | 33 | 12 | ~96% |

*(Corregido el 04/09: la fila de BMS decía ~83% porque era la única calculada sin sumarle sus 82 fuentes sin URL, criterio que las otras tres sí aplicaban. Con la misma fórmula da ~96%. Y ojo: **este techo es teórico** — supone que el descubridor recupera todo lo recuperable, y la corrida real mostró que recupera el 35%.)*

**Lo que sí distingue a BMS no es un techo más bajo: es el volumen absoluto de deuda.** Arrastra **217 fuentes entre rotas y sin dirección**, la pila más grande de los cuatro. **Y eso explica un patrón que veníamos arrastrando sin datos: el cliente con peor cobertura es el que más reportes de "no entró una nota" genera.** No es casualidad ni un problema de sus filtros. **Consecuencia operativa: el descubridor se corre primero sobre las fuentes de ese cliente**, aunque el piloto de cutover siga siendo el más chico. Son dos órdenes distintos y no hay que confundirlos: el piloto se elige por riesgo bajo, el orden del descubridor por dolor alto.

#### El descubridor (A0), construido y medido — 04/09

`wf/descubridor` sale **por Cloudflare, no directo** (medido: directo resuelve el 11%), prueba ~17 rutas por dominio y hace una **segunda vuelta** leyendo lo que declaran la home (`<link rel="alternate">`) y el `robots.txt` (`Sitemap:`). Esa segunda vuelta no es un adorno: es la que encuentra los feeds que ninguna lista de rutas adivina — Joomla los publica en `/?format=feed&type=rss`, y así aparecieron varios.

Corrido sobre las 442 en modo lectura (no escribió nada):

| Grupo | Fuentes | Feed encontrado | Feed válido pero vacío hoy | Sin salida |
|---|---|---|---|---|
| Mal apuntadas (tienen URL y responden) | 265 | **112 (42%)** | 101 (38%) | 52 (20%) |
| Sin URL (las 168 de `jina` + 9) | 177 | **42 (24%)** | 6 (3%) | 129 (73%) |
| **Total** | **442** | **154 (35%)** | 107 | 181 |

**147 de las 154 traen fecha** — 84 son feeds RSS/Atom y 70 son news-sitemaps con fecha de publicación, no índices pelados. Solo 7 quedaron sin fecha.

**Aplicado al catálogo el 04/09** (`[F2.2b]`, solo tablas v4 — ver más abajo por qué eso es seguro). Estado verificado en la base, sobre las 1.437 fuentes activas:

| | Fuentes | % |
|---|---|---|
| Entraban antes | 960 | 67% |
| **Entran ahora** | **1.112** | **77%** |
| + las 107 dudosas, si resultan feeds reales | ~1.219 | 85% |
| *Lo que este doc prometía antes* | *~1.380* | *~96%* |

**+152 fuentes, +10 puntos, sin comprar nada ni agregar transportes.** Es la mejora más grande del roadmap hasta ahora, pero no llega a donde decíamos. **Planificar sobre 96% es planificar sobre un número que no existe.**

*(152 aplicadas y no 154: dos fuentes se comportaron distinto al momento de escribir que al de medir. Se escribe solo lo verificado en esa misma corrida, nunca lo medido una hora antes.)*

El detalle de las 152, **con la URL previa de cada una**, queda en [`mediciones/2026-09-04-descubridor-aplicado.json`](./mediciones/2026-09-04-descubridor-aplicado.json). 112 tenían una URL cargada que se pisó; con ese archivo se revierte cualquiera.

#### Las 168 de `jina`: no eran basura, eran otra cosa

Se creyó que eran filas sembradas sin verificar. **No.** Salieron de la v3: esos mismos 168 dominios tienen `metodo='jina'` en `medios`, y la Fase 1 copió `metodo → transporte` tal cual. En la v3, `metodo='jina'` significa *este medio no tiene feed, se lee la página con Jina Reader* — por eso tienen `formato='html'` y ninguna URL de feed, ni acá ni en `medios`. **La migración no perdió nada; el modelo v4 mezcló dos ejes** (ver decisión 13).

El descubridor les encontró feed a **38 de las 168** — sí lo tenían y la v3 nunca se enteró. Quedan **130 fuentes (9% del catálogo) que genuinamente no van por feed** y necesitan el camino HTML. Ese camino ya existe en el plan con otro nombre: `sub/open-article` + el agente A1, en la Fase 5. Siguen marcadas `transporte='jina'` a propósito: es el registro de que la v3 sí sabe leerlas, y se convierten a `metodo_extraccion='html'` cuando se aplique `[F2.7]`.

**Por qué se pudo aplicar sin ceremonia:** el descubridor escribe en `medios_fuentes` y `medios_estrategia`, las dos creadas en la Fase 1. Verificado el 04/09: el dashboard no las referencia en ningún lado (usa `medios`, `medios_seguimiento`, `medios_bloqueados`), los clippings v3 leen `medios`, no hay triggers sobre ellas, ninguna función las usa y la única vista que depende es `v4_medicion_pendientes`, también v4. **Radio de daño sobre lo que el cliente usa hoy: cero.** El contracara es que estas 152 fuentes **no le sirven al cliente hasta el cutover** — el clipping de mañana sigue sin ellas. Llevarlas también a `medios` (la tabla de la v3) sería otra decisión, y esa sí toca producción.

**Pendiente de la fase:** decidir dónde vive el proxy AWS en producción (hoy corre en un proyecto de prueba).

**Tickets:** `[F2.1]` `sub/fetch-source` ✅ · `[F2.1b]` `sub/fetch-escalera` ✅ · `[F2.3]` medición de cobertura ✅ · `[F2.4]` decisión de gate ✅ (pasa) · `[F2.2]` `wf/descubridor` (A0) ✅ construido y medido · `[F2.2b]` aplicar al catálogo ✅ (152 fuentes, 04/09) · `[F2.2c]` re-correr las 107 "feed válido pero vacío" otro día: un feed vacío hoy puede tener notas mañana · `[F2.5]` dónde vive el proxy AWS en producción · `[F2.6]` dar de baja las 46 fuentes genuinamente inalcanzables (caídas, 404, timeout persistente) · `[F2.7]` separar `transporte` de `metodo_extraccion` en `medios_estrategia` (decisión 13).

### Fase 3 · Recolector por cliente + schema de prueba — `pendiente`

- **Sincronizar el schema `test` con producción** (agregarle las tablas nuevas de la v4).
- **`wf/recolector-cliente`** — un workflow por cliente. Barrido cada ~3 h + 06:30. Recorre las fuentes de *ese* cliente **leyendo `medios_estrategia`: va directo al transporte que ya se sabe que funciona**, y solo sube la escalera si ese transporte falla (y ahí actualiza la estrategia). Con control de concurrencia y lote.
- **Deduplicación al guardar** por URL canónica: cada barrido suma solo lo nuevo.
- Cierre de cobertura + aviso por barrido.
- Los cuatro recolectores usan los mismos ladrillos; cambian los parámetros por cliente.

**Salida:** el pool de cada cliente se llena a lo largo del día en `test`, en paralelo a su v3.

- **El recolector lee `metodo_extraccion`, no solo `transporte`** (decisión 13). Las ~126 fuentes sin feed no van por la escalera de feeds: van por el camino HTML de la Fase 5. Hasta que ese camino exista, el recolector las **saltea explícitamente y lo registra** — nunca las busca por directo con una URL vacía, que es lo que pasa hoy.

**Tickets:** `[F3.1]` sincronizar `test` con `public` · `[F3.2]` `wf/recolector-cliente` (plantilla, leyendo `medios_estrategia`) · `[F3.3]` dedup al guardar por URL canónica · `[F3.4]` instanciar el recolector ×4 con sus parámetros y horarios · `[F3.5]` cierre de cobertura + aviso · `[F3.6]` re-verificación periódica de la estrategia (un transporte que hoy anda puede dejar de andar; hay que refrescar `medios_estrategia` sin re-medir todo) · `[F3.7]` saltear y registrar las fuentes con `metodo_extraccion='html'` hasta que exista `sub/open-article`.

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
**BMS va segundo, no cuarto** — es donde más duele, pero ese dolor lo arreglan las Fases 2–4 (compartidas) y su recolector se construye en la Fase 3: BMS mejora en el schema de prueba desde la Fase 3, sin cortar nada. *(La medición del 03/09 lo confirma con datos: es el de peor cobertura, 62%, con 217 fuentes rotas o sin dirección. Por eso el descubridor arranca por él aunque el cutover arranque por el piloto.)*

**Tickets:** `[F8.1]` arnés de golden · `[F8.2]` staging del piloto · `[F8.3]` cutover de Booking · `[F8.4]` disparador de rollback + monitoreo.

### Fase 9 · Replicar al resto — `pendiente`

- Mismo pipeline. Cambia el identificador de cliente, el prompt, las suscripciones y el horario. Un cliente nuevo es una fila y un horario.
- Orden: **BMS → Mars → MSD.** Se confirma con los números de prueba de la Fase 6.
- Cada cutover desactiva la v3 de ese cliente. A los 30 días sin incidentes, se borran los workflows viejos y el modelo de medios con `client_id`.

**Tickets:** `[F9.1]` cutover BMS · `[F9.2]` cutover Mars · `[F9.3]` cutover MSD · `[F9.4]` baja de la v3 y del modelo viejo, pasados los 30 días.

---

## 4. Camino crítico

`Fase 0` → `Fase 1` ✅ → `Fase 2` (gate ✅, descubridor ✅, catálogo aplicado ✅) → **cerrar Fase 2: `[F2.7]` separar `metodo_extraccion`** ← acá estamos → `Fase 3` → `Fase 4` → `Fase 5` → `Fase 6` → `Fase 8` (piloto) → `Fase 9`

**Por qué no se saltó directo a la Fase 3:** el descubridor reescribe `url_feed` y `medios_estrategia`, que es exactamente lo que el recolector de la Fase 3 lee. Construir el recolector contra un catálogo que está por moverse obliga a re-verificar todo después. Por eso se aplicó primero lo encontrado (04/09) y recién después se construye encima. Falta `[F2.7]` por el mismo motivo: el recolector tiene que leer `metodo_extraccion`, no un `transporte` que mezcla dos cosas.

La **Fase 7** (dashboard) corre en paralelo: arranca apenas existan las tablas de descartes y de reglas, se completa contra las Fases 5 y 6.

Desde la Fase 3, el recolector de cada cliente corre en el schema de prueba en paralelo a su v3 — los números mejoran para los cuatro antes de cualquier cutover.

---

## 5. Riesgos y gates

- ~~**Gate de la Fase 2:** la medición de cobertura recuperable.~~ **Resuelto el 03/09: 76% entra hoy.** La capa de transporte se justifica y el bloqueo prácticamente desaparece como problema (queda 1 fuente bloqueada en 1.260).
- **Un PATCH de PostgREST que no matchea ninguna fila devuelve 204, igual que uno exitoso.** Encontrado el 04/09: los dos nodos de escritura del descubridor estaban encadenados en serie y el primero usa `Prefer: return=minimal`, así que devolvía `{}` y el segundo se quedaba sin campos — armaba `?dominio_norm=eq.` y no escribía nada. **El flujo reportó "154 escritas" y en la base no había entrado ninguna.** Dos reglas que salen de acá: los nodos de escritura van en paralelo desde el mismo item, no encadenados; y **el contador de escrituras se cuenta por `statusCode`, nunca por cantidad de items** — con `onError: continue` un fallo también produce item. Aplica a toda la Fase 3 en adelante.
- **El techo de cobertura es 77–85%, no 96% (medido y aplicado 04/09).** El descubridor recupera el 35% de las 442 fuentes rotas, no casi todas. **Quedan ~181 fuentes sin salida por feed**, de las cuales ~126 nunca tuvieron feed y dependen del camino HTML de la Fase 5. La v4 hereda un agujero más chico que el de la v3, pero lo hereda. Cualquier promesa de cobertura al cliente se hace sobre 78–85%.
- **PostgREST corta las lecturas en 1.000 filas y no avisa** (encontrado el 04/09 en el descubridor: pedía `limit=2000` sobre 1.437 fuentes y recibía 1.000, calculando los pendientes sobre un universo truncado sin que nada fallara). Aplica a **todo flujo v4 que lea una tabla grande por REST** — `medios_fuentes` (1.437), `medios_suscripcion` (2.102). Hay que paginar y hacer que el flujo falle ruidosamente si la última página viene llena. Revisar con este criterio los flujos de medición del 03/09.
- **Techo de memoria por tanda en n8n.** Medido: 35 dominios × ~17 candidatas retienen **21 MB** en el nodo HTTP; 70 dominios matan el proceso. Cualquier flujo que retenga cuerpos HTML tiene que ir por tandas chicas y no pedir dos veces la misma página.
- **Dependencia de un proveedor pago:** el 3% de las fuentes solo entra por Bright Data, que se cobra por request y hoy corre en plan de prueba. Antes de producción hay que dimensionar el costo del volumen real (nueve barridos diarios × cuatro clientes) y decidir si ese 3% lo vale.
- **La estrategia de transporte se desactualiza sola.** Un medio que hoy entra por un proxy puede cambiar mañana. `medios_estrategia` es una foto del 03/09: sin re-verificación periódica (`[F3.6]`) envejece en silencio y el recolector empieza a fallar sin que se note.
- **Configuración del proveedor de proxy:** una de las zonas de la cuenta tiene la IP del servidor de n8n en su lista de bloqueo, y por eso rechazaba todo con 401 aunque la credencial fuera válida. Se resolvió usando otra zona de la misma cuenta, sin tocar la configuración. Queda pendiente entender por qué está ese bloqueo (probablemente explica por qué el nodo equivalente de la v3 quedó apagado y marcado como pendiente).
- **Flujos en vuelo:** nada de la Fase 0 que toque la cuenta compartida se ejecuta sin coordinarlo con el responsable de esa cuenta.
- **Zonas horarias:** se resuelve antes de escribir el recolector. Todo en UTC, se decide en hora local; una fecha sin hora nunca se compara contra un corte horario.
- **Carga de n8n:** cuatro recolectores × ~9 barridos/día. Vigilar memoria y solapamiento; escalonar los horarios entre clientes si hace falta.
- **Segundo proxy en producción:** hoy vive en un proyecto de prueba. Decidir dónde vive antes de la Fase 3.
- **Límite de la ejecución manual de n8n:** las corridas con volumen alto mueren si se disparan con el botón (n8n retiene el set completo en memoria para mostrarlo en pantalla). Por webhook, el mismo trabajo pasa. Aplica a cualquier flujo masivo de la v4, no solo a la medición.
- **Drift de migraciones del repo** (preexistente): `supabase db push` no es seguro hasta reconciliar — ticket aparte.
- **Autor ≠ aprobador:** cada fase que promueve a `public` o activa un workflow necesita revisión de un segundo.
- **Fuera de alcance:** gacetillas, editor web y exportación, clientes en formato legado.
