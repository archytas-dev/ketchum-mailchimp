# Roadmap · Pipeline v4 de Clipping

El plan de construcción: fases, orden, dependencias y tickets. El **qué y el cómo** (arquitectura, modelo de datos, decisiones, alternativas) están en [`design-doc.md`](./design-doc.md) — este doc no los repite.

**Estado:** en construcción · **Rama:** `feat/pipeline-v4` (fuente de verdad de la v4) · **Última actualización:** 2026-09-07 (**Fase 4 cerrada** y **el barrido corriendo solo**: `[F4.4]` el registro de descartes nunca había podido correr, ahora escribe los ocho motivos con el valor que los disparó y es idempotente · `[F4.6]` el corte de fecha sale de `p_fecha` y no del reloj, más la compuerta `fecha_futura` · `[F3.8]` los 9 cron encendidos tras tres días sin pool · la v3 confirmada corriendo en la cuenta compartida)

---

## Índice

1. [Por qué](#1-por-qué)
2. [Decisiones de enfoque](#2-decisiones-de-enfoque)
3. [Las fases](#3-las-fases)
4. [Camino crítico](#4-camino-crítico)
5. [Riesgos y gates](#5-riesgos-y-gates)
6. [Pendiente al cierre del roadmap](#6-pendiente-al-cierre-del-roadmap)

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
6. **Un recolector compartido, no uno por cliente** *(revertido el 04/09 — antes decía lo contrario)*. El motivo para partirlo por cliente era el riesgo de que "una corrida de ~1.800 medios agote recursos y se caiga". **Ese número no era real:** con transporte que funciona son **1.028 dominios**. Y medido, uno por cliente cuesta **44% más de requests** (1.480 vs 1.028 por barrido) y golpea **299 dominios 2–4 veces en la misma ventana desde la misma IP** — el bloqueo autoinfligido que `[F0.1]` quería eliminar, y la Fase 0 se omitió. Además `candidatas_raw` **no tiene `client_id`**: el pool ya es compartido, así que las copias 2ª–4ª se descartan por dedup y se paga el fetch cuatro veces para guardar una fila. El riesgo de recursos se resuelve **por webhook y en tandas** (como el descubridor), no partiendo por cliente. **El "por cliente" se mueve al armado**, que es donde el cliente importa.
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

### Fase 0 · Higiene y base — `OMITIDA (decisión del 04/09)`

> **No se ejecuta.** Los ítems quedan acá documentados porque siguen siendo deuda real — ver el detalle de qué se arrastra en [Camino crítico](#4-camino-crítico). `[F0.2]` además se cerró por quedar sin objeto.

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

### Fase 2 · Transporte y cobertura — `✅ cerrada (04/09)`

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

El descubridor les encontró feed a **38 de las 168** — sí lo tenían y la v3 nunca se enteró. Quedan **130 fuentes que genuinamente no van por feed** y necesitan el camino HTML. Ese camino ya existe en el plan con otro nombre: `sub/open-article` + el agente A1, en la Fase 5.

#### `[F2.7]` aplicada (04/09): los dos ejes, separados

`medios_estrategia` ahora tiene **`transporte`** (red: `directo|cloudflare|aws|brightdata`) y **`metodo_extraccion`** (`feed|html`), y `jina` salió del dominio de `transporte` — no era una red. El método se derivó de `formato`, que ya distinguía los dos casos bien. Estado verificado:

| Método | Transporte | Fuentes | Qué significa |
|---|---|---|---|
| `feed` | cloudflare · directo · brightdata · aws | **1.112** | entran hoy |
| `feed` | — | 147 | tienen feed, no se llega o el feed no sirve |
| `html` | — | **178** | no hay feed: dependen de `sub/open-article` (Fase 5) |

Son **178 y no 130**: a las 130 de `jina` se sumaron 48 que tienen URL cargada pero apuntan a HTML, no a un feed (`no_es_feed`). Mismo problema de fondo, mismo camino de salida. `get_advisors` sin hallazgos nuevos sobre la tabla.

**Por qué se pudo aplicar sin ceremonia:** el descubridor escribe en `medios_fuentes` y `medios_estrategia`, las dos creadas en la Fase 1. Verificado el 04/09: el dashboard no las referencia en ningún lado (usa `medios`, `medios_seguimiento`, `medios_bloqueados`), los clippings v3 leen `medios`, no hay triggers sobre ellas, ninguna función las usa y la única vista que depende es `v4_medicion_pendientes`, también v4. **Radio de daño sobre lo que el cliente usa hoy: cero.** El contracara es que estas 152 fuentes **no le sirven al cliente hasta el cutover** — el clipping de mañana sigue sin ellas. Llevarlas también a `medios` (la tabla de la v3) sería otra decisión, y esa sí toca producción.

**Pendiente de la fase:** decidir dónde vive el proxy AWS en producción (hoy corre en un proyecto de prueba).

**Tickets:** `[F2.1]` `sub/fetch-source` ✅ · `[F2.1b]` `sub/fetch-escalera` ✅ · `[F2.3]` medición de cobertura ✅ · `[F2.4]` decisión de gate ✅ (pasa) · `[F2.2]` `wf/descubridor` (A0) ✅ construido y medido · `[F2.2b]` aplicar al catálogo ✅ (152 fuentes, 04/09) · `[F2.2c]` re-correr las 107 "feed válido pero vacío" otro día: un feed vacío hoy puede tener notas mañana · `[F2.5]` dónde vive el proxy AWS en producción · `[F2.6]` dar de baja las 46 fuentes genuinamente inalcanzables (caídas, 404, timeout persistente) · `[F2.7]` separar `transporte` de `metodo_extraccion` ✅ (04/09).

### Fase 3 · Recolector compartido + schema de prueba — `en curso` *(solo queda `[F3.1]`, pospuesto a `[Z.1]`)*

**El recolector está construido y corrió un barrido completo (04/09).** `v4 · wf · recolector (compartido)` — ID `tzcHSIUdMGXVRFIo`, webhook `POST /v4-recolector`, body `{limite, offset, modo}`.

| | |
|---|---|
| Fuentes intentadas | **1.112** (todas, 0 pendientes al cierre) |
| Con notas (`ok`) | **1.039 · 93%** |
| Notas al pool | **52.019**, todas con URL canónica distinta |
| Dominios que aportaron | 944 |
| Tandas | 19 de 60 · ~17 s cada una |

**El dedup vive en la base, no en n8n.** `candidatas_raw.url_canonica` es **columna generada** por `url_canonica(url)` (la función es `IMMUTABLE`), más un **índice único `(fecha, url_canonica)`**. El recolector inserta la URL cruda y la base decide. Así el dedup es una propiedad de la tabla: atómico, sin leer el pool en memoria, e idéntico para los cuatro clientes y los nueve barridos. Probado: `https://www.Test.com/nota-1?utm_source=x` y `https://test.com/nota-1` colisionan.

**Y probado entre barridos, que es el caso que importa:** el segundo barrido del día re-trajo 1.036 fuentes y ~37.700 notas, y el pool creció **445 filas** (52.019 → 52.464). El 99% eran las mismas notas y se ignoraron solas. Ese es el número que dice que la decisión 8 funciona.

**Antigüedad de lo que trae un barrido** — el pool es crudo, las compuertas de la Fase 4 son las que filtran:

| | Notas |
|---|---|
| Hoy | 12.422 |
| Ayer | 7.120 |
| Última semana | 4.047 |
| Último mes | 3.986 |
| Más viejo | 2.770 |
| **Sin fecha confiable** | **21.674** |

Los 21.674 sin fecha son casi todos de sitemap, que devuelve las últimas N URLs sin `lastmod`. **Es el volumen que justifica `resolver_fecha()` de la Fase 4**: sin resolverles la fecha, o se descarta el 42% del pool o entran notas viejas — que es exactamente el reporte "nota vieja o repetida" de la v3.

**Cuatro bugs que costó encontrar y que aplican a toda la Fase 4 en adelante:**

1. **Al nodo HTTP le faltaba `fullResponse`.** Sin él no hay `statusCode`, así que la rama de fetch directo caía siempre en `timeout`: **las 138 fuentes `directo` se reportaban como caídas con `http_status` en `NULL`**. Se veía como un problema de red y era un campo que no pedí.
2. **`fetch_log.pasada` tenía el enum del diseño viejo** (`nocturna_1/2/3 · caliente · diurna`), del esquema de tres pasadas que la decisión 7 reemplazó. Rechazaba el identificador de barrido. Ahora es un patrón: `barrido_YYYY-MM-DD_HH`.
3. **El proxy inventa diagnósticos que no están en el CHECK** (`http_202`, `error_red`). Como el insert es en bulk, **una fila inválida mata las 60** — y sin `fetch_log` el barrido pierde la reentrancia, porque la vista de pendientes no puede excluir lo que no ve hecho. Cuatro tandas seguidas trajeron las mismas fuentes. Se agregó un clamp al enum.
4. **`Prefer: resolution=ignore-duplicates` resuelve sobre la primary key, no sobre cualquier índice único.** Hay que decirle cuál: `?on_conflict=fecha,url_canonica`. Sin eso el POST devuelve **409 y se pierde el lote entero** — pasó con 2.260 notas.

**Y un error de diseño propio:** la vista de pendientes excluía solo las `ok`, así que las ~26 que fallan por tanda quedaban pendientes dentro de la ventana, se reintentaban en cada tanda y tapaban el avance — el barrido no convergía. **Regla correcta: en un barrido cada fuente se intenta una vez**; lo que falla lo toma el barrido siguiente (hay 9 por día). Efecto lateral bueno: la vista se vacía sola, así que el recolector se llama siempre con `offset=0` y no hay que llevar la cuenta.

- **Sincronizar el schema `test` con producción** (agregarle las tablas nuevas de la v4).
- **`wf/recolector`** ✅ — **uno solo, compartido** (decisión 6). Barrido cada ~3 h + 06:30, **disparado por webhook y por tandas de 60**. Recorre las 1.112 fuentes con transporte **leyendo `medios_estrategia`: va directo al que ya se sabe que funciona**. Lee `metodo_extraccion`: las 178 `html` no entran a la vista de pendientes hasta que exista `sub/open-article`.
  *Pendiente de la fase:* que suba la escalera cuando el transporte conocido falla (hoy solo registra el diagnóstico) — va junto con `[F3.6]`.
- **Deduplicación al guardar** por URL canónica: cada barrido suma solo lo nuevo.
- **`wf/barrido`** ✅ — el driver que drena el barrido entero: itera tandas y espera cada una. **Corrió completo: 13 tandas, 671 fuentes, 624 ok, 2m16s.** Un barrido desde cero (1.112 fuentes) son ~19 tandas ≈ 3,5 min.
- Cierre de cobertura + reporte por barrido.

**Salida:** el pool compartido se llena a lo largo del día con nueve barridos, en paralelo a las v3 que siguen intactas. *(No en `test`: el pool vive en las tablas v4 de `public`, que nadie más consume — ver `[F3.1]`.)*

#### El encadenado (`[F3.4b]`), y por qué son dos workflows

`wf/barrido` (driver, ID `wEuM4z6hIuLGwQFF`) itera; `wf/recolector` hace una tanda. **La división no es estética, es la única que funciona:**

- **El recolector no puede auto-encadenarse.** Probado el 04/09: n8n **cancela la ejecución hija si el que la disparó corta la conexión**, así que "disparar y no esperar" no existe con un webhook de `responseMode=responseNode`. Y si espera, las 19 tandas quedan anidadas: la primera cuelga hasta que termina la última, y el primer timeout se lleva la cadena entera.
- **Tampoco sirven dos webhooks en el mismo workflow** (uno que responda al instante para la cadena): n8n rechaza la ejecución con *"Unused Respond to Webhook node found"* si entra por un webhook `onReceived` habiendo un nodo de respuesta en el flujo.
- **El driver itera, no recurre.** En cada vuelta hay una sola ejecución de recolector abierta, y el driver solo retiene los resúmenes (unos KB). Los cuerpos HTTP quedan en la ejecución del recolector — que es lo que respeta el techo de 21 MB por tanda.
- **`batchSize=1`, en serie.** Dos tandas simultáneas se pisarían: las dos leerían los mismos pendientes antes de que ninguna escriba `fetch_log`.

**Un gotcha de n8n que costó una corrida:** `$('nodo').all()` devuelve **solo la última vuelta del loop**, no todas. Hay que pedir cada corrida por índice — `.all(0, runIndex)`. El driver corrió 3 tandas y el resumen reportó 1.

**El cron está construido y deshabilitado a propósito.** Habilitarlo hace que el recolector escriba en la base nueve veces por día sin que nadie lo dispare: es una decisión, no un default.

#### Un transporte, un nodo — y las 16 fuentes que costó el atajo

La v1 del recolector usaba **un solo nodo HTTP** con la credencial de Cloudflare para todos los transportes. La nota decía *"las fuentes directo y aws ignoran el header X-Api-Key"*. **Era falso, y salió caro:** el proxy AWS es una Edge Function de Supabase y **exige `Authorization: Bearer`** — no ignoraba el header equivocado, rechazaba el pedido. **Las 16 fuentes `aws` fallaban el 100%** con diagnóstico `error`, y se veía como un problema de las fuentes.

Ahora hay un Switch y **tres nodos, uno por credencial**. Verificado: 16 de 16 ok, +310 notas.

Dos consecuencias de partir en ramas que hay que tener presentes:

- **El pareo pedido↔respuesta ya no puede ser por índice global.** El Switch reparte los items y los índices dejan de coincidir. Se aparea **por índice dentro de cada rama**.
- **Hace falta un Merge antes de normalizar.** Con tres ramas entrando al mismo nodo, n8n lo ejecuta **una vez por rama** — tres veces — y escribiría `fetch_log` y el pool triplicados.

#### `[F3.6]` re-verificación de la estrategia — ✅ construida y corrida

`wf/re-verificar estrategia` (ID `y5UXitrQdQ5UkKL4`). `medios_estrategia` es una foto y envejece sola: un medio que hoy entra por Cloudflare puede dejar de entrar mañana, y sin esto el recolector empieza a fallar en silencio.

Toma las fuentes cuyo **último** intento falló con algo que la escalera puede resolver, y les prueba los transportes **distintos** al que ya falla. **Corrida del 04/09: 17 re-verificadas → 15 recuperadas, 2 siguen mal.** Las 15 pasaron de `cloudflare` a `directo` (138 → 153).

**Qué NO entra a re-verificación, a propósito:** `sin_items` (el feed es válido y está vacío — no es una falla y cambiar de transporte no lo arregla, decisión 11), `no_es_feed` (es trabajo del descubridor) y `no_existe` (404: va a baja).

**El desempate es por posición en la escalera, no por volumen.** Cuando `directo` y `aws` traen los dos, gana `directo`: es gratis y más rápido. La primera versión elegía "el que más notas trae" y mandaba 14 fuentes a `aws` sin necesidad — contradecía la decisión 10, que dice *"corta en el primero que trae notas"*. El volumen solo desempata a igual posición.

**Y no baja fuentes de golpe:** ninguno de los transportes anda → suma un fallo. A los 5 fallos consecutivos pasa a `transporte = NULL` con el motivo, **sin desactivar la fuente** — queda visible para el descubridor y para la pantalla de salud. `brightdata` queda afuera de la escalera de re-verificación: se cobra por request y va solo contra el bloqueo (decisión 11), así que se propone aparte.

**El cron (diario 07:15 ART, después del último barrido) también nace deshabilitado.**

#### `[F3.7]` nada se saltea en silencio — ✅

Las 178 `metodo_extraccion='html'` se salteaban bien pero **no aparecían en `fetch_log`**: un día roto y un día sin esas fuentes se veían igual, que es justo lo que la v4 existe para evitar. Ahora entran a la vista de pendientes y el recolector las registra como `no_visitado` sin salir a buscarlas — mismo camino que las 32 de `brightdata`.

**A las `html` se les deja `transporte` en `NULL` a propósito.** Poner `'html'` ahí volvería a mezclar los dos ejes que `[F2.7]` separó; para saber por qué no se visitaron se cruza con `medios_estrategia.metodo_extraccion`. Y **no se les exige URL**: a las 130 que vienen de la v3 no se les conoce ninguna, y justamente por eso hay que verlas.

**Un barrido completo, ahora visible entero** (1.290 fuentes, ninguna en silencio):

| Método | Transporte | Diagnóstico | Fuentes |
|---|---|---|---|
| feed | cloudflare | ok | 901 |
| feed | directo | ok | **135** |
| feed | aws | ok | **16** |
| feed | brightdata | `no_visitado` | 32 |
| feed | cloudflare | caído · sin_items · timeout · bloqueado | 25 |
| feed | directo | sin_items | 3 |
| html | — | `no_visitado` | **178** |

**1.052 ok de 1.112 con feed (95%)** — arriba de los 1.036 de la primera corrida, por el arreglo del nodo AWS y la re-verificación.

**Y un tercer efecto del Switch por transporte que casi cuesta caro:** las `html` tienen `transporte` en `NULL`, así que **no matcheaban ninguna rama y desaparecían en el Switch** — el Merge no recibía nada, `Normalizar` nunca corría y el barrido reportaba **0 fuentes**. Antes funcionaba de casualidad: las de `brightdata` viajaban de pasajeras con las que sí tenían transporte. Hizo falta una **cuarta salida de fallback** en el Switch, cableada al Merge. Regla: un Switch sin fallback tira los items que no matchean, sin avisar.

- **El recolector lee `metodo_extraccion`, no solo `transporte`** (decisión 13). Las ~126 fuentes sin feed no van por la escalera de feeds: van por el camino HTML de la Fase 5. Hasta que ese camino exista, el recolector las **saltea explícitamente y lo registra** — nunca las busca por directo con una URL vacía, que es lo que pasa hoy.

**Tickets:** `[F3.1]` sincronizar `test` con `public` · `[F3.2]` `wf/recolector` compartido ✅ (04/09) · `[F3.3]` dedup por URL canónica ✅ (columna generada + índice único) · `[F3.4]` vista de pendientes ✅ · `[F3.4b]` `wf/barrido` (driver) + los 9 cron ✅ construidos (04/09) — **el cron queda deshabilitado hasta que se decida encenderlo** · **`[F3.4c]` conectar el nodo de Bright Data** — las 32 fuentes se registran `no_visitado` y se saltean; la credencial está cargada, pero **antes hay que dimensionar el costo**: se cobra por request y son ~9.250 fetches/día · `[F3.5]` cierre de cobertura + reporte · `[F3.6]` re-verificación de la estrategia ✅ (04/09) · `[F3.7]` registrar las fuentes sin feed ✅ (04/09).

`[F3.5]` cierre de cobertura + reporte ✅ (04/09).

**Queda abierto de la fase:** `[F3.4c]` (Bright Data, con el costo dimensionado antes).

**`[F3.1]` sincronizar `test` — pospuesto al final del roadmap (decisión del 04/09).** El plan original era que el recolector escribiera ahí "para no tocar datos reales". Hoy pasa lo contrario: el pool vive en las tablas v4 de `public`, que tienen RLS y nadie más consume, y **`test` es el lugar menos protegido de la base**. Mover 52.000 filas por día ahí sería llevarlas a un schema que cualquiera puede vaciar. Ver el ticket de seguridad al final.

#### `[F3.5]` el reporte: tres vistas, cero escrituras — ✅

Son **vistas, no un flujo**: `fetch_log` ya tiene un renglón por intento, así que el reporte es una consulta y no un dato nuevo que haya que mantener sincronizado. Y son **vistas y no avisos**: el ticket original decía "+ aviso a Slack"; con la regla de que nada salga hacia afuera, el reporte se consulta.

| Vista | Qué contesta |
|---|---|
| `v4_barrido_resumen` | cómo salió cada ventana: duración, ok, notas, fallas por tipo |
| `v4_cobertura_dia` | el rollup del día y el pool |
| `v4_fuentes_mudas` | las que se supone que andan y hace 14 días no traen nada |

**El día 04/09, con dos barridos:** 1.290 fuentes tocadas · 1.055 con notas · 210 no visitadas · **25 visitadas sin dar nada** · 98% de cobertura de las visitadas · pool de 52.464 (30.694 con fecha).

**Dos decisiones de cómo se cuenta, que son la mitad del valor de esto:**

- **`no_visitado` sale del denominador.** Las 178 `html` y las 32 de `brightdata` no se intentan todavía; contarlas como falla mezcla *"no anduvo"* con *"todavía no se intenta"* y hunde el número sin que nadie haya roto nada.
- **`v4_fuentes_mudas` exige haber sido visitada.** La primera versión metía las de `brightdata` — cuyo único diagnóstico es `no_visitado` — y diluía la señal con el mismo error. **Muda = se visitó y no dio una sola nota.** Con el filtro corregido da 25, que cuadra exacto con `visitadas_sin_notas` de la otra vista.

**El recolector no escribe en el ledger, y está bien:** `pipeline_runs.client_id` es `NOT NULL` y la clave es `(client_id, fecha, modo)` — el ledger modela *"una corrida de un cliente"*, y desde la decisión 6 el recolector es compartido. El ledger es del armado por cliente (Fase 6); el ledger del recolector es `fetch_log`.

**Pendiente que destraba el aviso de verdad:** `medios_catalogo.ritmo_publicacion_semanal` está **sin poblar** (todo `NULL`), así que el orden por ritmo de `v4_fuentes_mudas` todavía no prioriza nada. Poblarlo es lo que convierte la lista en una alerta útil: un medio que publica 50 notas por semana y está mudo es un problema; uno que publica una cada tanto, no.

#### `[F3.8]` los cron encendidos — ✅ (07/09)

**`[F3.4b]` estaba bien cerrado; el cron nacía deshabilitado a propósito.** Su propia nota lo decía: *"NACE DESHABILITADO a propósito: habilitarlo hace que el recolector escriba en la base 9 veces por día sin que nadie lo dispare. Es una decisión, no un default."* Lo que faltaba no era código, era tomar esa decisión. Se tomó el 07/09.

Encendidos los dos cron de la v4:

| Workflow | Cron | Qué hace |
|---|---|---|
| `v4 · wf · barrido` | 08 · 11 · 14 · 17 · 20 · 23 · 02 · 05 y **06:30** ART | llena el pool |
| `v4 · wf · re-verificar estrategia` | diario **07:15** ART | reprueba el transporte de las que empezaron a fallar |

El de re-verificación va entre el barrido de 06:30 y el de 08:00 a propósito: arregla la estrategia justo antes del barrido que alimenta el clipping del día. Cierra el riesgo de *"`medios_estrategia` es una foto del 03/09 y envejece en silencio"*.

**Costo de haberlo dejado apagado: tres días sin pool.** El último barrido había sido el 04/09 19:39, y todas las ejecuciones del driver eran `mode: webhook` — o sea, a mano. Lo del 05, 06 y la mañana del 07 **no se recupera**: los feeds solo traen las últimas N notas y lo que rotó no está en ningún lado.

**Primer barrido con los cron ya encendidos** (disparado a mano para no esperar a las 14:00):

| | |
|---|---|
| Pasada | `barrido_2026-09-07_12` · 23 tandas · **0 falladas** · 5m09s |
| Fuentes | 1.288 · **1.050 ok** |
| Notas al pool | **33.675** *(33.795 traídas − 120 que descartó el dedup)* |
| Con fecha confiable | 30.866 · **92%** — mismo ratio que el 04/09 |
| Dominios que aportaron | 1.044 |
| Diagnósticos | ok 1.050 · no_visitado 210 · sin_items 12 · timeout 8 · caído 6 · bloqueado 1 · no_es_feed 1 |

`v4_recoleccion_pendientes` quedó en **0**: el barrido la drena entero, que es como está diseñada la reentrancia. Y los 210 `no_visitado` quedaron escritos en `fetch_log` — `[F3.7]` haciendo su trabajo.

**De paso quedó contestado lo que estaba abierto sobre la v3.** Los cuatro clippings del día se generaron entre las **06:50 y 07:42 ART** con `origen='n8n'`: la v3 **está corriendo en la cuenta compartida y el cliente recibe sus clippings**. Los workflows que figuran inactivos en la instancia de Archytas son copias. Verificado además que el barrido no la tocó: escribió a las 11:56–12:01 ART, cuatro horas después, y el recolector no tiene un solo nodo que apunte a `notes`, `clippings`, `exports` ni `medios`.

**Regla que se mantiene:** nada de lo que se construya acá manda mensajes. Los 24 nodos de la cadena (driver + recolector) son `httpRequest` a Supabase o a los proxies de transporte, `code`, `if`, `switch`, `merge` y `webhook`. Cero Slack, cero mail. `sub/slack-notify` y `sub/send-email` de la Fase 6 se van a construir porque están en el diseño, pero **nacen deshabilitados y sin conectar**.

### Fase 4 · Normalización + compuertas — `✅ cerrada (07/09)`

#### Lo primero no era resolver fechas: era sacar la basura de ingesta

El 04/09 el pool tenía **21.674 notas sin fecha confiable (42%)** y lo reporté como *"el volumen que justifica `resolver_fecha()`"*. **Estaba mal leído.** El desglose:

| Origen | Dominios | Notas sin fecha |
|---|---|---|
| **Índices históricos completos** | **5** | **16.084 — el 74%** |
| Feeds mixtos | 29 | 3.826 |
| Volumen normal sin fecha | 39 | 1.860 |

**Un solo medio, `maracodigital.net`, aportaba 12.001 notas — el 23% del pool entero.** Su sitemap tiene 12.003 URLs y **cero `<lastmod>`**: es el archivo histórico del sitio, no las noticias del día. Es el riesgo *"fecha fresca-falsa"* del design doc en su forma más pura — un medio capaz de empujar 12.000 notas viejas al filtro, todas pareciendo nuevas, y **ninguna compuerta de fecha las puede filtrar porque no tienen fecha**.

Y no se arreglaba resolviendo: **RSS trae fecha el 98%**, el problema es solo sitemap; esos medios **no tienen feed alternativo** (probados `/feed/`, `/sitemap-news.xml`, `/news-sitemap.xml` → 404 en los tres); y **la URL tampoco la trae** (42 de 21.770 con patrón de fecha). La única salida habría sido abrir cada nota: 16.000 por barrido, nueve veces por día.

**La regla de detección es volumen SIN FECHAS, nunca volumen solo.** `v4_indices_historicos` marca ≥300 notas con ≤2% fechadas. El matiz importa: **`elmonterizo.com` trae 3.841 notas y las 3.841 tienen fecha**, 3.658 de las últimas 48 h — es una fuente legítima y prolífica, y marcarla por volumen habría sido un error caro.

#### Cuatro de los seis tenían el feed real declarado y nunca se lo buscamos

`news_sitemap.xml` — con guion **bajo** — estaba en su `robots.txt`, y no estaba en la lista del descubridor:

| Dominio | Antes | Después |
|---|---|---|
| `infotecrealico.com.ar` | 1.026 sin fecha | **39 con fecha y título** |
| `rumoresdepehuajo.com.ar` | 1.025 sin fecha | **10 con fecha y título** |
| `elurbanodesancarlos.com` | 1.018 sin fecha | **12 con fecha y título** |
| `radiocapital913.com.ar` | 1.014 sin fecha | **10 con fecha y título** |

Se les corrigió la URL y **se agregó el patrón al descubridor** (`news_sitemap.xml` y `sitemap_news.xml`), que es donde tenía que estar desde el principio.

Los otros dos (`maracodigital.net`, `novaclima.com.ar`) no declaran ninguno y no se les encontró alternativa: se les quitó el transporte con el motivo `indice_historico_sin_fechas`. **No se desactiva la fuente** — salen del recolector pero siguen visibles para el descubridor y para la pantalla de salud, y vuelven solas el día que se les encuentre un feed real.

**Resultado sobre el pool del día:**

| | Antes | Ahora |
|---|---|---|
| Pool | 52.464 | 39.613 |
| **Con fecha confiable** | 30.694 · **58%** | 36.635 · **92%** |
| Notas de las últimas 24 h | 15.059 | **18.328** |

Se fue el ruido y **subieron** las notas útiles. La lección para el resto de la fase: *antes de construir maquinaria para procesar un volumen, mirar de dónde sale ese volumen.*

#### `[F4.3]` las reglas, como datos — ✅ (globales + Booking)

`reglas_filtro` tiene **9 reglas** traducidas leyendo el nodo `Normalize + Dedup + Pre-filter` de la v3 de Booking — ~300 líneas de JavaScript, repetidas en 4 workflows. Cada fila lleva **el motivo escrito**, que es lo que va a leer el dashboard.

Las globales: markdown roto en el título · ruido financiero · TLD extranjero · antigüedad 24 h · título corto sin copete. Las de Booking: URL del propio cliente · el medio publicador *es* el cliente · **menciona la marca → `entra_si_o_si`** · nota sobre otro mercado.

Dos hallazgos de la traducción:

- **`titulo_corto` no existía en el CHECK de `tipo`.** La Fase 1 no previó ese tipo de regla y la v3 sí la aplica. Se agregó.
- **El flujo de Booking filtra ruido financiero** (`vende acciones|holdings|shares`) que parece copiado del de BMS. Es exactamente el arrastre que esta tabla viene a hacer visible: en JavaScript nadie lo ve, como fila con motivo sí.

#### `[F4.2]` `normalizar_y_compuertas()` — ✅

Del pool compartido a las candidatas de un cliente. **Determinística y en SQL**: una definición para los cuatro, y dos corridas del mismo día dan lo mismo — es un test del golden.

Orden: **suscripción → fecha → compuertas → dedup**. La dedup va última a propósito: si una nota se cae por regla, ese descarte dice más que *"era repetida"*.

Tres reglas de comportamiento que quedaron en la función y no en la tabla, porque no se expresan en un regex:

- **`entra_si_o_si` gana sobre todo.** Se evalúa primero y ninguna otra regla puede sacar esa nota. Y **una nota prioritaria nunca se deduplica cross-medio**: cada medio que la publica es un placement distinto.
- **La antigüedad solo descarta con fecha confiable.** No se descarta por vieja algo de lo que no se sabe cuándo se publicó — es la regla del design doc, ahora aplicada.
- **La excepción argentina:** una nota sobre otro mercado que además dice "argentin" no se descarta.

**El embudo de Booking, medido:**

| | Notas |
|---|---|
| Pool compartido | 39.613 |
| Suscritas a Booking | 5.574 |
| − viejas (>24 h, con fecha confiable) | −2.170 |
| − título pobre | −1.388 |
| **Candidatas** | **2.173** · 109 medios · 2.099 de las últimas 24 h |

**Los cuatro clientes corren con la misma función**, que era el punto de ponerla en SQL:

| Cliente | Candidatas |
|---|---|
| MSD | 7.701 |
| Mars | 6.784 |
| BMS | 6.717 |
| **Booking** | **2.173** |

#### `[F4.3b]` las reglas de los otros tres — ✅

**Cada cliente las tenía en un nodo distinto**, que es por qué nadie las había visto juntas:

| Cliente | Dónde vivían |
|---|---|
| BMS | `Quality Guard PRE-AI` (~220 patrones) |
| MSD | `Quality Guard POST-AI` |
| Mars | `Quality Guard POST-AI` |
| Booking | `Normalize + Dedup + Pre-filter` |

Y los `PRE-AI` de MSD y Mars son **passthrough byte a byte, los dos rotulados "BOOKING"**: copiados y nunca adaptados.

**No se migraron ~160 reglas, y no es un olvido.** La v4 solo trae lo que está en el catálogo suscripto; la v3 además ingería el agregador por búsqueda abierta, y por eso le entraba internet entero. Medido: **0 fuentes de agregador en la v4**, y de 54 dominios extranjeros de la lista de BMS **solo 12 están en el catálogo**. Las ~40 reglas que matchean por *nombre de medio* existían solo porque la v3 no podía resolver el dominio detrás del redirect — la v4 siempre sabe el `dominio_norm`. **La arquitectura resolvió arriba lo que la v3 filtraba abajo.**

Quedaron **30 reglas**: 11 globales, 6 de BMS, 5 de MSD, 4 de Mars, 4 de Booking.

#### La cuarta compuerta: `desambiguacion`

Probando con datos reales apareció un bug de diseño mío: **"Karol G y Bruno Mars se ponen cariñosos" entraba como PRIORITARIA para Mars.** La regla de marca (`\ymars\y`) es `entra_si_o_si`, se evalúa primero y le ganaba a la regla de farándula.

El arreglo no fue hacer el regex más astuto —POSIX no tiene lookbehind, y el problema volvería con el próximo caso ambiguo— sino reconocer que hay **dos clases de descarte duro con distinta precedencia**:

| Compuerta | Qué dice | Precedencia |
|---|---|---|
| `desambiguacion` | la palabra **parece** la marca y no lo es (Bruno Mars, el planeta Marte, el escritor Roemmers) | **gana sobre todo** |
| `entra_si_o_si` | menciona al cliente de verdad | le gana al descarte por tema |
| `no_entra_nunca` | el tema no le sirve al cliente | — |
| `puntua` | suma o resta, no decide sola | — |

**Sin esa distinción, toda marca ambigua es una puerta abierta.** Verificado después del cambio: Bruno Mars ya no entra.

**Los cuatro clientes, con sus reglas:**

| Cliente | Candidatas | Prioritarias |
|---|---|---|
| MSD | 7.452 | 0 |
| Mars | 6.608 | 2 |
| BMS | 6.572 | 11 |
| Booking | 2.130 | 1 |

**Los tres siguen en ~7.000 y eso es correcto:** su filtro temático real lo hace la IA (`AI Filter Paralelo`), no las compuertas — por eso sus `PRE-AI` son passthrough. Las compuertas sacan basura verificable; **decidir si una nota de salud animal le interesa a MSD es trabajo del juez A2, en la Fase 5.** Booking baja a 2.130 porque su filtro es de keywords, que sí es determinístico.

#### `[F4.1]` + `[F4.5]` el historial anti-repetición — ✅

**El problema, medido:** el historial tenía 9.806 filas y **5.243 (53%) eran URLs de redirector crudas**. Una URL de redirector nunca vuelve a matchear la real, así que esas notas **se podían re-enviar para siempre** — es la mitad del reporte *"nota vieja o repetida"*.

`url_canonica()` ahora desenvuelve los **dos** formatos del agregador: el de parámetro (`?url=`, `?q=`) que ya resolvía, y el **token base64** de `news.google.com/rss/articles/…`, que se decodifica a LATIN1 —no a UTF8, porque el contenido es protobuf con bytes que no son texto válido y UTF8 aborta—. Si el token no se puede decodificar devuelve la URL original: **nunca inventa una**.

**Reconstrucción del historial:**

| | Filas |
|---|---|
| Recuperadas del formato `?url=` | **3.075** |
| Colisiones consolidadas *(la misma nota guardada dos veces — el bug en persona)* | 47 |
| **Usable: 47% → 78%** | 7.591 de 9.759 |

Hay backup en `notas_historico_url_backup_20260904`. Verificado end-to-end: `es_repetida()` detecta una nota ya enviada aunque venga con tracking, y da `false` para una nueva.

**Y 2.168 filas son irrecuperables, con una causa que vale como lección:** el normalizador de la v3 pasaba **toda** la URL a minúsculas, incluido el token base64. Base64 distingue mayúsculas, así que `CBMiK2h0…` quedó `cbmik2h0…` y **la información se destruyó al guardar**. No hay de dónde sacarla.

Eso valida una decisión del diseño v4 que parecía un detalle: `url_canonica()` pasa a minúsculas **solo el host**, nunca el path ni el query. Fallan del lado seguro — solo pueden dejar pasar una repetición, nunca bloquear una nota legítima.

#### `[F4.4]` la escritura de descartes — ✅ (07/09)

**No era "falta correrla": no podía correr.** El bloque de registro insertaba sin `fase`, que es `NOT NULL` y sin default, así que **toda** llamada con `p_registrar=true` —que es el **default**— moría en `23502`. Por eso `notas_descartadas` tenía **0 filas** con `etapa='compuerta'`: las mediciones del 04/09 salieron todas pasando `p_registrar=false` explícitamente, y nadie notó que el camino por default estaba roto.

Y aun arreglando eso, el bloque solo miraba los descartes **por regla**. El embudo real de Booking dice que eso es el 9% *(números finales, ya con el corte de `[F4.6]`)*:

| Motivo | Notas | ¿Quedaba registrado antes? |
|---|---|---|
| Antigüedad | 2.625 | ❌ |
| Título pobre | 874 | ❌ |
| Markdown roto en el título | 162 | ✅ |
| Otro mercado | 95 | ✅ |
| Portal de empleo | 61 | ✅ |
| URL de home o de comentarios | 25 | ✅ |
| **Ya enviada** (historial) | **16** | ❌ *(la compuerta ni existía)* |
| Aviso de empleo por título | 3 | ✅ |
| Repetida en el día | 2 | ❌ |
| Fecha futura | 1 | ❌ *(la compuerta ni existía)* |
| **Total descartes** | **3.864** | |
| **Candidatas** | **1.710** | |

**El embudo cierra exacto:** 3.864 + 1.710 = 5.574 suscritas. Ninguna nota se pierde sin dejar dicho por qué — que es la condición para que la pantalla "Notas que no entraron" signifique algo.

Tres arreglos más, cada uno con su motivo:

- **`valor_que_matcheo` escribía siempre el dominio**, fuera cual fuera la regla. Ahora escribe **lo que matcheó de verdad**, buscándolo primero en el texto y después en la URL: `![` para el markdown roto, `alemanes` para otro mercado, `bebee.` para el portal de empleo, `/feeds/…/comments/` para la URL de comentarios, `postular` para el aviso de empleo. Eso es lo que la Fase 7 necesita mostrar; el dominio no explica nada.
- **No era idempotente.** La tabla solo tenía PK sobre `id` (un uuid generado), así que el `on conflict do nothing` **no matcheaba nada**: re-ejecutar el día habría duplicado el embudo entero. Hay índice único parcial `(client_id, fecha, md5(url), motivo) where etapa='compuerta'` —parcial para no tocar las filas de la v3—. Verificado: dos corridas seguidas, **5.509 filas, 5.509 únicas**.
- **La lógica estaba escrita dos veces** (una para devolver candidatas, otra para registrar descartes) y ya divergía: el registro no filtraba por fuente activa ni por suscripción bloqueada. Ahora vive una sola vez en **`v4_evaluar_candidatas()`**, y `normalizar_y_compuertas()` la usa para las dos cosas. No pueden volver a separarse.

**`es_repetida()` quedó enganchada**, que era el otro pendiente: entra como último escalón, después de la dedup del día. En Booking sacó **9 notas ya enviadas** en los últimos 30 días — las primeras que el historial reconstruido de `[F4.5]` atrapa en producción.

#### El hallazgo que rompe el golden: la antigüedad se mide contra `now()`

Correr `normalizar_y_compuertas(cliente, '2026-09-04')` **hoy** (07/09) no da lo mismo que darle el 04/09. La compuerta de antigüedad compara `fecha_pub < now() - 24 h`, así que **el resultado depende de cuándo la corras**, no solo de qué datos tenga:

| Cliente | Suscritas | Viejas si corre hoy | Viejas con el corte del día |
|---|---|---|---|
| BMS | 15.377 | 14.506 | **7.677** |
| MSD | 21.891 | 20.206 | **13.264** |
| Mars | 14.255 | 13.539 | **6.813** |
| Booking | 5.574 | 5.099 | **2.784** |

Casi el doble de descartes, sobre los mismos datos. Y contradice lo que este mismo doc afirma en `[F4.2]`: *"dos corridas del mismo día dan lo mismo — es un test del golden"*. **Es cierto solo dentro de la misma ventana de 24 h.** La Fase 8 compara la v4 contra la v3 sobre un día ya pasado: tal como está, el arnés de golden mediría la diferencia entre dos relojes y la leería como una diferencia de criterio.

#### `[F4.6]` el corte sale de la fecha, no del reloj — ✅ (07/09)

**Decidido: "el clipping del martes trae lo publicado el martes".** El corte es el fin del día `p_fecha` en hora local (`America/Argentina/Buenos_Aires`), así que `normalizar_y_compuertas(cliente, '2026-09-04')` da lo mismo se corra hoy, mañana o en la Fase 8.

**Lo que cambia y se acepta a sabiendas:** una nota publicada el lunes 23:00 **ya no entra** en el clipping del martes. Antes entraba —a las 06:30 tenía 7 h de vida—. Si Ketchum espera ver la nota de anoche, el corte se corre; pero se corre **en un solo lugar** y sigue siendo determinístico. Vale preguntárselo.

**La alternativa que se descartó, anotada por las dudas:** agregar `p_corte timestamptz default now()`, que producción pase `now()` y el golden pinee el instante de la corrida original. Conservaba el comportamiento exacto de hoy y no cambiaba nada para el cliente. **Se descartó porque deja el bug vivo:** depende de que todo llamador nuevo se acuerde de pasar el parámetro, y si se olvida el problema vuelve en silencio. `[F4.4]` es la prueba de que eso no se sostiene — `p_registrar=true` estuvo roto tres días justamente porque nadie ejecutó el camino por default. Si algún día Ketchum pide las 24 h rodantes de verdad, este es el camino y el cambio es de una línea.

**La ventana tiene dos bordes, y el de arriba estaba abierto.** El pool del 04/09 tiene **11 notas fechadas después de ese día, una en 2029**. Nunca eran "viejas", así que entraban siempre — y como el orden de salida es `fecha_pub desc`, **encabezaban el clipping**. Es el riesgo *"fecha fresca-falsa"* del design doc por el lado que no habíamos mirado. Ahora hay compuerta `fecha_futura`, y va **antes que la marca del cliente**: una fecha imposible es un defecto del dato, no un juicio de relevancia.

**El otro `now()` también se cerró, sin tocar producción.** `es_repetida()` medía contra `current_date - 30`, y **`import_clipping()` —que está en producción— la usa**, así que cambiarle la firma no era una opción. La regla se mudó a **`es_repetida_al(client, url_ya_canonizada, fecha)`**, determinística, y `es_repetida()` quedó como fachada que delega pasando `current_date`. Una sola definición de la regla, dos puertas de entrada: la v3 sigue entrando por donde entraba.

**De paso resolvió un problema de performance que recién apareció acá.** Con el corte viejo sobrevivían 74 notas, así que la compuerta anti-repetición se llamaba 74 veces. Con el corte nuevo sobreviven miles, y **la primera corrida de los cuatro clientes se murió por `statement timeout`**: cada llamada recalculaba `url_canonica()` —con su decode base64— sobre una URL que **ya estaba canonizada en una columna generada**. Pasarle esa columna, en vez de la URL cruda, convierte la compuerta en un lookup contra el índice único `(client_id, url_norm)`. Verificado que la columna generada no quedó desactualizada tras `[F4.1]`: 0 de 20.000 difieren.

> **La lección, que aplica a las Fases 5 y 6:** una compuerta barata cuando descarta casi todo se vuelve cara cuando deja pasar. El costo de una etapa hay que medirlo con el volumen que va a tener *después* de arreglar la etapa anterior, no con el de hoy.

**Los cuatro clientes, con todo aplicado:**

| Cliente | Suscritas | Descartes | Candidatas |
|---|---|---|---|
| MSD | 21.891 | 15.973 | **5.918** |
| BMS | 15.377 | 9.916 | **5.461** |
| Mars | 14.255 | 8.864 | **5.391** |
| Booking | 5.574 | 3.864 | **1.710** |

**Determinismo verificado:** dos corridas seguidas de Booking dan 1.710 las dos veces, y `notas_descartadas` queda en **38.617 filas, 38.617 únicas**.

Y las compuertas nuevas atraparon lo que tenían que atrapar: **15 notas con fecha futura** (9 BMS, 3 Mars, 2 MSD, 1 Booking), **43 ya enviadas** en los 30 días previos, y **46 Bruno Mars** que la desambiguación de Mars sacó antes de que la marca las hiciera prioritarias.

- Completar `url_canonica` con el decode de los redirectores del agregador.
- `normalizar_y_compuertas()`: normaliza → resuelve fecha (cascada, nunca inventa) → deduplica (una regla) → tres compuertas.
- Poblar `reglas_filtro` traduciendo el JavaScript de los cuatro workflows, una sola vez.
- Cada descarte se escribe con la regla exacta y el valor que la disparó.
- Reconstruir el historial anti-repetición con la URL canónica.

**Cierra:** el grueso de "fuente extranjera", "vieja / repetida", la mitad de "no relevante", y "exclusiva que no entró".

**Tickets:** `[F4.1]` `url_canonica` decode de redirectores ✅ · `[F4.2]` `normalizar_y_compuertas()` ✅ · `[F4.3]` poblar `reglas_filtro` ✅ · `[F4.3b]` reglas de BMS, MSD y Mars ✅ · `[F4.5]` reconstruir el historial ✅ — **todos el 04/09** · `[F4.4]` escritura de descartes con regla + valor ✅ + compuerta anti-repetición enganchada · `[F4.6]` corte de antigüedad determinístico ✅ + compuerta `fecha_futura` — **07/09**.

**Fase 4 cerrada.** El pipeline determinístico va de punta a punta: del pool compartido a las candidatas de cada cliente, con cada descarte escrito con su regla y su valor, sin duplicar al re-ejecutar y sin depender del reloj. La Fase 8 ya puede escribir su arnés de golden contra esto.

**Lo único que quedó afuera y hay que preguntarle a Ketchum:** si el clipping de la mañana tiene que traer la nota publicada anoche a las 23:00. Con el corte elegido no la trae. Es una línea de cambio, pero es decisión del cliente, no nuestra.

### Fase 5 · Los agentes — `arrancada (07/09)`

#### `[F5.0]` los prompts de la v3, migrados a `client_prompts` — ✅ (07/09)

`client_prompts` existía desde la Fase 1 —con `version`, `vigente` y `vigente_desde`— pero **con 0 filas**. Se hizo el mueble y nunca se mudó la ropa: los prompts seguían hardcodeados como `SYSTEM_MESSAGE` dentro del nodo `AI Filter Paralelo` de cada v3.

**Dónde estaban de verdad:** en la instancia **`archytasai.app.n8n.cloud`**, no en `n8n-ketchum`. Los cuatro workflows activos con tag `prod`, tocados el 02/09. *(Los que se ven en `n8n-ketchum` son copias inactivas.)*

**No se transcribieron a mano.** Un prompt con un carácter mal no rompe nada visible: el juez simplemente empieza a decidir distinto y nadie se entera hasta que el cliente se queja. Se armó un workflow de un solo uso —`Ketchum · v4 · extraer prompts de la v3`, `usaCmyYb2N62U8FD`, **solo lee**— que los saca por la API de n8n y los devuelve; la escritura se hizo desde afuera sobre ese JSON, con literales dollar-quoted.

El parseo **respeta los backticks escapados**: el prompt contiene `` \`id\` ``, y un regex ingenuo habría cortado el texto por la mitad sin avisar.

**Verificado por SHA-256, origen contra destino:**

| Cliente | Caracteres | SHA-256 | |
|---|---|---|---|
| BMS | 20.702 | `b55ab4c5…` | ✅ |
| MSD | 13.944 | `105867f5…` | ✅ |
| Booking | 11.350 | `9e1a0146…` | ✅ |
| Mars | 11.038 | `2edb7a76…` | ✅ |

*(Booking cuenta 11.349 en Postgres y 11.350 en JS: el hash coincide, así que los bytes son los mismos. La diferencia es que JS cuenta unidades UTF-16 y Postgres caracteres, y ese prompt tiene un emoji fuera del plano básico.)*

**Lo que se aprende de tenerlos juntos:**

- **No hay contaminación cruzada entre clientes**, a diferencia de lo que apareció en `[F4.3b]` con las reglas de filtrado. Cada prompt habla solo de su cliente.
- **BMS pesa casi el doble que el resto.** Vale mirarlo cuando se escriba el A2.
- **El modelo y la temperatura también estaban hardcodeados ahí**, y el código documenta las decisiones con fecha y motivo: `gpt-4o` con `temperature=0.1`, *"subido desde gpt-4o-mini el 12/08 por mejor adherencia a reglas complejas, mismo cambio ya validado en MSD el 03/07"*. El clustering usa `text-embedding-3-small`. **Eso achica el bloqueante "qué modelo usar": ya hay uno elegido, probado y con la contra conocida** (Tier 1 TPM ~30k contra 200k de mini, más chance de 429).

> **Esto es el punto de partida, no el destino.** El juez de la v3 solo devuelve `{"ids": [...]}`: decide si la nota entra. El A2 de la v4 tiene que decidir **relevancia y sección**. Hay que extenderlos — pero ahora se extienden como filas versionadas, no editando JavaScript en producción.

**De paso, dos hallazgos operativos:**

- **Hay dos `Ketchum - Clipping Msd v3` activos.** Los dos disparan 10:30 UTC: `19NPw3POuwTKdUsK` corre ~12 min (el real) y `gXXA9qIJ844k6OUs` arranca y muere en 0,3 s. No duplica el clipping, pero se ejecuta todos los días al pepe y confunde: tiene 108 nodos, más que el real. Es el `[F0.7]`, que sigue abierto.
- **Confirmado el `[F0.3]`:** la API key de OpenAI se lee de `GSID` en texto plano, con la credencial de n8n solo como respaldo.

#### `[F5.2a]` `sub/fetch-page` y la escalera para las sin feed — ✅ (07/09)

**`sub/open-article` eran dos trabajos con el mismo nombre.** El design doc lo describe como *"abre una nota individual (para A1)"* y el roadmap además le asignaba las 178 fuentes `html`. Son cosas distintas: para A1 la entrada es **una nota** y la salida **su cuerpo**; para las 178 la entrada es **la home de un medio** y la salida **una lista de N notas**. Mismo transporte, contrato de salida distinto.

Se partió en **`sub/fetch-page`** (el ladrillo: URL + transporte → HTML crudo) y dos consumidores encima. Así el de la lista se entrega ya, sin esperar a la Fase 5, y A1 reusa el mismo ladrillo cuando llegue.

**No hubo que tocar el proxy:** el worker de Cloudflare ya tenía `&raw=1`.

#### El transporte de las páginas no se parece al de los feeds

Medido el 07/09 sobre 40 de las 178, subiendo la escalera completa:

| | Feeds (03/09) | Páginas (07/09) |
|---|---|---|
| Abren por **directo** | 138 de 1.260 · 11% | **27 de 40 · 68%** |
| Abren por cloudflare | 774 · 61% | 0 *(no hicieron falta)* |

**La decisión 10 —"el proxy no es el plan B, es el camino principal"— vale para feeds, no para páginas.** Tiene sentido visto de atrás: una home está hecha para que la visiten; un `/feed/` o un `sitemap.xml` es justo lo que los CDN protegen. **Consecuencia práctica: el camino HTML no consume cuota de proxy.**

**27/40 abren (68%)**, y **23 de esas 27 usaron la URL derivada** de `https://dominio` — la heurística para las 113 sin `url_recurso` se sostiene. No se persiste ninguna URL adivinada hasta que abra: guardar una que nunca se probó es peor que no tener ninguna, porque parece dato.

*Caveat: en `modo=test` la consulta devuelve siempre las mismas 40 alfabéticas. El 68% es una estimación gruesa, no un dato sobre las 178.*

#### Dos bugs propios, encontrados por los datos

- **`$('Entrada').first()`** en el normalizador, copiado del patrón de `sub/fetch-source`. n8n manda los N items en **una sola sub-ejecución**, así que los N resultados se creían el primer dominio: `9dejulio.gob.ar` aparecía dos veces con diagnósticos distintos. Ahora usa `$itemIndex`. **`sub/fetch-source` tiene el mismo patrón** — hoy no le duele porque la escalera lo llama de a uno, pero está anotado.
- **HTTP 405 caía en `vacio`.** Un sitio que rechaza el método no es una página sin links: uno se arregla cambiando el pedido, el otro no se arregla. Ahora es `metodo_rechazado`.

#### Lo que falta antes de encender las 178

**La vista `v4_recoleccion_pendientes` ya las incluye** — el roadmap decía que no entraban hasta que existiera `open-article` y **era falso**: la condición es `metodo_extraccion='html'` a secas, sin mirar el transporte. Por eso el barrido reporta 210 `no_visitado`.

Entonces **persistir el transporte antes de que exista el extractor sería prender el motor sin la caja**: el recolector iría a las 178 nueve veces por día, recibiría HTML, diría "esto no es un feed" y traería cero notas. ~1.600 visitas diarias a cambio de nada. **El orden correcto es extractor primero, `modo=prod` después.**

#### `[F5.2b]` el extractor — `en curso` (07/09)

`wf/recolector-html` es el espejo de `wf/recolector` para las fuentes sin feed: en vez de parsear un XML, saca las notas del HTML de la home. **Heurística pura, sin IA** — el agente A1 limpia lo que salga de acá, no lo reemplaza.

Seis filtros en orden: mismo dominio → fuera navegación por ruta y por extensión → **tiene que parecer una nota** → dedup por URL → título de 25+ caracteres (el mismo umbral que la compuerta `titulo_corto`) → fuera títulos de menú.

**Medido sobre 10 fuentes reales: 364 notas de 6 medios**, 61 por medio. Los títulos son noticias de verdad, no menú.

**Tres bugs, y los tres los encontró la instrumentación, no el ojo.** La primera corrida dio **cero** notas. Agregarle al extractor un **contador de rechazos por etapa** convirtió "no saco nada" en un diagnóstico:

| Bug | Cómo se vio | Arreglo |
|---|---|---|
| **`new URL()` no existe** en el sandbox de los Code node | 1.272 de 1.334 anclas morían en `no_http` | Todo el parseo de URL a mano con strings, como ya lo hace `sub/fetch-source` |
| **El id de la nota va en el query**, no en la ruta | 478 rechazos por `no_parece_nota`, entre ellos `9dejulio.gob.ar/noticia.php?id=9734` con título real | Se mira también el query: `?id=`, `?nota=`, `?articulo=`… |
| **Encoding latin1 leído como UTF-8** | `agritotal.com` y `agrolatam.com` devuelven `aprob�`, `El Ni�o` | **Abierto** — ver abajo |

> **La lección, que aplica a los agentes de la Fase 5:** un extractor que devuelve cero no dice por qué. El contador de rechazos por etapa costó diez líneas y ahorró adivinar entre seis filtros. Los agentes A1/A2/A3 necesitan lo mismo: no alcanza con el veredicto, hace falta el motivo.

**Lo que falta de `[F5.2b]`:**

- **`[F5.2b-i]` el encoding — abierto, y el camino obvio ya se probó y no anda.** 2 de 6 medios devuelven títulos rotos (`aprob�`, `El Ni�o`): están en ISO-8859-1, **no declaran charset en el header** (`Content-Type: text/html` a secas) y n8n los decodifica como UTF-8. Una vez decodificado mal, el byte se perdió: no hay como recuperarlo del texto.

  **Intento 1 (fallido):** pedir la respuesta **binaria** en `fetch-page` y decodificar leyendo el `<meta charset>` de los bytes. El binario llega —el charset se calcula— pero el cuerpo no es HTML: los 10 medios pasaron a `vacio` con 0 anclas. **Intento 2 (fallido):** `Accept-Encoding: identity` por si venía comprimido. Tampoco, y el `User-Agent` que se agregó de paso hizo que `accionrural.com.ar` empezara a devolver 403. Revertido a texto; verificado que vuelve a dar 364 notas.

  **Conclusión: el buffer que expone el Code node de n8n no es el cuerpo de la respuesta** (probablemente por el modo de almacenamiento de binarios de la instancia). Insistir por ahí es tanteo.

  **La solución, en dos piezas — código listo, falta desplegar:**

  **1. El worker decodifica bien.** `Response.text()` de Cloudflare tiene *el mismo bug* que n8n: decodifica como UTF-8 sin preguntar. Se cambió a `arrayBuffer()` + un decodificador propio que mira el `charset` del header, si no está el `<meta>`, y si tampoco infiere por validez UTF-8. **No usa `TextDecoder` con etiquetas distintas de `utf-8`** porque el runtime de Workers no las garantiza: ISO-8859-1 es un mapeo byte→codepoint directo y se hace a mano; windows-1252 solo difiere en `0x80-0x9F`. Probado aislado, los cuatro casos pasan: latin1 sin declarar, utf8 sin declarar, latin1 en el header y latin1 en el `<meta>`.

  **2. Los medios rotos escalan solos al proxy.** El arreglo del worker no servía de nada por sí solo: `agritotal.com` y `agrolatam.com` entran por **directo**, no por el proxy. Ahora `fetch-page` cuenta los caracteres de reemplazo y, si hay 3 o más **y** venía por directo, devuelve `diagnostico='charset_roto'` — que se sumó a la lista de escalada de `wf/medir-html`. O sea: **el charset roto deja de ser un error terminal y pasa a ser una razón para subir un escalón**, exactamente como el bloqueo o el timeout.

  El HTML se devuelve igual aunque esté roto: mejor una nota con un acento mal que ninguna, para quien no pueda escalar. Verificado que `charset_roto` se dispara en `agritotal.com` y `abchoy.com.ar` sin regresión (363 notas de 7 medios).

  **Pendiente: `npx wrangler login && npx wrangler deploy`** en `docs/pipeline-v4/prototipos/cloudflare-worker`. Es interactivo (abre el navegador), así que no se pudo hacer desde acá. **El cambio es de bajo riesgo para los 911 feeds que ya usan el proxy:** si el charset es UTF-8 declarado, o es UTF-8 válido sin declarar, el resultado es byte a byte el mismo que hoy. Solo cambia el comportamiento cuando el contenido **no** es UTF-8 válido — que hoy ya devuelve basura.
- **`[F5.2b-ii]` las fechas — medido el 07/09, y el número es grande.** De las 363 notas extraídas, **ninguna** trae fecha en la URL. Entran con `fecha_confiable=false`, y la compuerta de antigüedad —por diseño— no descarta lo que no se sabe cuándo se publicó.

  **Hoy eso casi no pasa.** El pool tiene 8,1% de notas sin fecha, pero apenas llegan a candidata: Booking 64 (3,7%), MSD 79 (1,3%), **BMS y Mars cero**.

  **Con las 178 encendidas, cambia de escala:**

  | Cliente | Candidatas hoy | Medios `html` suscriptos | Notas sin fecha/día *(est.)* | Impacto |
  |---|---|---|---|---|
  | BMS | 5.461 | 103 | ~3.642 | **+67%** |
  | MSD | 5.918 | 78 | ~2.758 | +47% |
  | Mars | 5.391 | 46 | ~1.627 | +30% |
  | Booking | 1.710 | 18 | ~636 | +37% |

  *(52 notas por medio medidas × 68% que abren.)*

  **El riesgo real no es el volumen: es lo evergreen.** Una nota vieja que el medio deja linkeada en la home entra **todos los días, para siempre**. El dedup del día no la frena (es de un día), y `es_repetida()` tampoco (solo atrapa lo ya **enviado**). Sin fecha, ninguna compuerta la puede descartar.

  **La salida que propongo, y que no inventa ninguna fecha:** usar **la primera vez que la vimos** como estimación de frescura. `candidatas_raw` ya guarda una fila por día y URL canónica, así que la primera aparición de una URL es un dato que ya tenemos. Si una URL de una fuente `html` viene apareciendo desde hace días y nunca se envió, no es noticia de hoy — es mueble de la home. Es honesto porque no dice *"se publicó tal día"* sino *"la vemos desde tal día"*, que es exactamente lo que sabemos.

  **Resuelto el 07/09 con la compuerta `vista_antes_sin_fecha`.**

  **La señal se validó antes de construirla**, y con un control cruzado que se podía medir: de las 36.236 notas del pool de hoy, 15.652 ya se habían visto el 04/09. De las que **sí** traen fecha confiable y ya se habían visto, **11.948 eran viejas contra 1.037 frescas**. O sea: *"ya la vimos"* predice *"es vieja"* con **92% de acierto**, contrastado contra la fecha real de las notas que la traen. Y de las 2.919 sin fecha, **2.667 (91%) ya estaban**.

  La compuerta descarta una nota **solo si no trae fecha propia Y ya estaba en el pool un día anterior**, y escribe en el descarte desde cuándo la venimos viendo. No inventa ninguna fecha: no dice *"se publicó tal día"* sino *"la vemos desde tal día"*, que es exactamente lo que sabemos. Respeta la regla del design doc.

  **Medido sobre el pool del 07/09:** Booking 1.423 candidatas con **391 frenadas**; BMS 4.611 con **690 frenadas**. Sin la compuerta habrían entrado 1.814 y 5.301.

  **Por qué era la única salida posible:** el dedup del día no la ve (es de un día), `es_repetida()` tampoco (solo atrapa lo ya **enviado**) y la compuerta de antigüedad —por diseño— no descarta lo que no tiene fecha. Sin esto, una nota vieja pegada en la home de un medio `html` entraba **todos los días para siempre**.

  Hizo falta un índice nuevo: el único que había era `(fecha, url_canonica)`, que no sirve para buscar por URL sola porque `fecha` es la columna líder. Se agregó `(url_canonica, fecha)`.

#### `[F5.2b-iii]` las fuentes sin feed salen del recolector de feeds — ✅ (07/09)

**Estuvo a punto de pasar sin que nadie lo viera.** `v4_recoleccion_pendientes` incluía `metodo_extraccion='html'` **sin mirar el transporte**. Mientras esas fuentes no lo tenían, no molestaba: quedaban como `no_visitado` —los 210 de cada barrido—. Pero apenas se les escribiera el transporte, el recolector de **feeds** las iba a agarrar, pedirles la página, recibir HTML, decir *"esto no es un feed"* y traer **cero notas**, nueve veces por día. ~1.600 visitas diarias a cambio de nada.

Se partió en dos vistas en vez de meterle una rama al recolector principal: ese flujo ya está probado y le costó cuatro bugs encontrados a los golpes; abrirlo para esto es arriesgar lo que funciona. Y separados, cada uno tiene su tanda y su tope de memoria — **154 KB por página medidos, contra unos pocos KB de un feed**.

| Vista | Quién la lee | Qué trae |
|---|---|---|
| `v4_recoleccion_pendientes` | `wf/recolector` | solo `feed`, con transporte y URL usable |
| `v4_recoleccion_html_pendientes` | `wf/recolector-html` | solo `html`, **con transporte ya medido** |

Y `wf/barrido-html`, el driver que las drena por tandas de 10, con los mismos 9 cron **15 minutos después** que el de feeds para no pisarse. Mientras ninguna fuente `html` tenga transporte, la vista está vacía y no hace nada.

**Tres cosas que faltaban y aparecieron probando en vacío:**

- **`recolector-html` no escribía `fetch_log`.** Sin eso la vista no se vacía sola, el barrido no converge y cada tanda vuelve a traer lo mismo — es el bug que ya costó cuatro tandas repetidas en la Fase 3. Va en rama **paralela** a la escritura de candidatas, no encadenado, que es la otra lección de esa fase.
- **`fetch_log.diagnostico` tiene vocabulario cerrado** y `fetch-page` usa cuatro que no están (`vacio`, `charset_roto`, `metodo_rechazado`, `sin_raw`). Con el insert en bulk, **una fila inválida mata el lote entero**. Se acotó al enum: `vacio→sin_items`, `charset_roto→ok` (trajo la página; el charset lo resuelve la escalera), los otros dos a `error`.
- **Con la vista vacía, el webhook no respondía.** PostgREST devuelve `[]`, n8n produce **cero items** y saltea todo lo que sigue, así que `Responder` nunca corría. Y la vista se vacía al final de **cada** barrido: no es un caso raro, es el de todos los días. Se arregla con `alwaysOutputData` en el nodo de lectura. *(Chequeado: el recolector de feeds ya lo tenía.)*

#### `[F5.2c]` las 178 encendidas — ✅ (07/09)

**74 de 178 tienen puerta de entrada** (64 por directo, 10 por proxy). Las otras 104 no abren por ningún transporte: timeout, bloqueo, 404 o páginas sin un solo link.

**Resultado del primer barrido HTML:** 84 fuentes intentadas, 78 ok, **1.236 notas al pool** de 31 medios. Y llegan al cliente: **Booking pasa a 2.118 candidatas, 159 de fuentes que hasta hoy aportaban cero.**

**El bug que casi se lleva todo puesto: `fetch-page` perdía items cuando los transportes venían mezclados.** El Switch repartía en tres ramas HTTP y cada una iba **sola** al normalizador, sin juntarlas: `executeWorkflow` devuelve **una** rama, así que pedir 5 fuentes devolvía 1 y pedir 10 devolvía 3.

No se había visto porque `wf/medir-html` llama con **todos los items en el mismo transporte** —cada escalón de la escalera es uno solo—, así que ahí funcionaba de casualidad. `wf/recolector` ya tenía su *"Juntar las cuatro ramas"* por exactamente esta razón; `fetch-page` no.

Al agregar el Merge apareció el problema de al lado: **el orden de salida ya no es el de entrada**, así que emparejar por índice se rompe. Se pasó a **`$('Entrada').item`**, el emparejamiento que n8n rastrea a través de los nodos. Es el tercer bug de índice del día — los otros dos fueron `.first()` en este mismo normalizador y el lookup por posición en `medir-html`.

> **La regla, para las Fases 5 y 6:** en n8n nunca se empareja por índice. Un IF que filtra, un Merge que reordena o una sub-ejecución que agrupa rompen la correspondencia, **y lo hacen en silencio**. Se empareja por `.item`, o por una clave del propio dato.

**Y dos escrituras que fallaban sin decir nada:**

- **No se mandaba `fuente_id`.** `normalizar_y_compuertas()` hace `join medios_fuentes on f.id = c.fuente_id`, así que una nota sin él entra al pool y **no llega a ningún cliente**. Las primeras 984 notas extraídas quedaron inertes.
- **Se mandaba una columna `origen` que no existe** (la real es `fecha_origen`). PostgREST devuelve 400 y, con `neverError`, el lote se pierde entero.

Las dos las tapaba el mismo defecto de reporte: el resumen decía `guardadas: 129` **sin haber mirado la respuesta**. Ahora cuenta por `statusCode` y expone `escrituras_fallidas` con el detalle — que es la lección de la Fase 3 que estaba escrita y no aplicada acá.

**Tickets:** `[F5.2a]` `sub/fetch-page` + `wf/medir-html` ✅ · `[F5.2b]` el extractor ✅ · `[F5.2b-i]` charset ✅ *(vía escalera, sin desplegar)* · `[F5.2b-ii]` compuerta anti-evergreen ✅ · `[F5.2b-iii]` separación de vistas + `wf/barrido-html` ✅ · `[F5.2c]` las 178 encendidas ✅. **El camino HTML está cerrado.**

**Queda anotado, menor:** el contador de tandas de `wf/barrido-html` reporta siempre 1 — `$('Correr una tanda').all()` devuelve solo la última vuelta del bucle. El barrido **funciona** (la vista queda en 0), lo que miente es el resumen.

---

**Lo que sigue de la fase, bloqueado por decisiones:**

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

### Fase 9 · Cutover del resto — `pendiente`

> **Se llamaba "Replicar al resto" y el nombre confundía:** hacía pensar que hay que rehacer el pipeline tres veces. **No se construye nada acá.** El recolector, el dedup, `v4_evaluar_candidatas()` y `reglas_filtro` son **uno solo para los cuatro** — el 07/09 los cuatro clientes corrieron por la misma función. Lo único que se instancia ×4 es `wf/armado-cliente`, y eso se construye en la **Fase 6**. Lo demás que cambia por cliente son filas: el prompt de A2, las suscripciones, las secciones y el horario. La Fase 9 son **tres cutovers**, no tres construcciones.
>
> **Y van de a uno porque el rollback es por cliente.** El disparador es "dos días fuera de banda o una queja = volver". Prendiendo los cuatro juntos, un problema da cuatro clientes molestos y ninguna forma de saber si falla la arquitectura o la config de uno.

- Mismo pipeline. Cambia el identificador de cliente, el prompt, las suscripciones y el horario. Un cliente nuevo es una fila y un horario.
- Orden: **BMS → Mars → MSD.** Se confirma con los números de prueba de la Fase 6.
- Cada cutover desactiva la v3 de ese cliente. A los 30 días sin incidentes, se borran los workflows viejos y el modelo de medios con `client_id`.

**Tickets:** `[F9.1]` cutover BMS · `[F9.2]` cutover Mars · `[F9.3]` cutover MSD · `[F9.4]` baja de la v3 y del modelo viejo, pasados los 30 días.

---

## 4. Camino crítico

~~`Fase 0`~~ *(omitida por decisión del 04/09 — ver abajo)* → `Fase 1` ✅ → `Fase 2` ✅ (gate · descubridor · catálogo aplicado · `metodo_extraccion`) → `Fase 3` (recolector ✅, dedup ✅, barrido automático ✅; falta sincronizar `test`) → `Fase 4` ✅ (07/09) → **`Fase 5`** ← acá estamos (arrancada: fetch-page ✅, falta el extractor) → `Fase 6` → `Fase 8` (piloto) → `Fase 9`

**Por qué la Fase 2 se cerró antes de arrancar la 3:** el descubridor reescribe `url_feed` y `medios_estrategia`, que es exactamente lo que el recolector de la Fase 3 lee. Construir el recolector contra un catálogo que está por moverse obliga a re-verificar todo después. Se aplicó primero lo encontrado y se separó `metodo_extraccion`, así el recolector se escribe una sola vez contra un modelo que no se va a mover.

**La Fase 0 se omite** (decisión del 04/09). Consecuencias que quedan abiertas y hay que tener presentes, no son gratis:

- **`[F0.6]` estaba acoplado a la Fase 3.** El recolector escribe en el schema `test` y `[F3.1]` es sincronizarlo. Al omitir la Fase 0, la Fase 3 trabaja sobre ese schema **tal como está**: `get_advisors` (04/09) reporta **28 tablas de `test` sin RLS**, legibles y vaciables con la clave pública del front.
- **`[F0.3]`** — las tres API keys en texto plano en el nodo de config de la v3 siguen expuestas, una de un servicio que se cobra por uso.
- **`[F0.4]`** — la valorización sigue al 16% en vez del 36% medido. Es plata que el cliente deja sobre la mesa todos los días y no depende de la v4.
- **`[F0.5]`** — la Fase 4 va a heredar el historial anti-repetición con URLs de redirector crudas.

La **Fase 7** (dashboard) corre en paralelo: arranca apenas existan las tablas de descartes y de reglas, se completa contra las Fases 5 y 6.

Desde la Fase 3, el recolector de cada cliente corre en el schema de prueba en paralelo a su v3 — los números mejoran para los cuatro antes de cualquier cutover.

---

## 5. Riesgos y gates

- ~~**Gate de la Fase 2:** la medición de cobertura recuperable.~~ **Resuelto el 03/09: 76% entra hoy.** La capa de transporte se justifica y el bloqueo prácticamente desaparece como problema (queda 1 fuente bloqueada en 1.260).
- **Un PATCH de PostgREST que no matchea ninguna fila devuelve 204, igual que uno exitoso.** Encontrado el 04/09: los dos nodos de escritura del descubridor estaban encadenados en serie y el primero usa `Prefer: return=minimal`, así que devolvía `{}` y el segundo se quedaba sin campos — armaba `?dominio_norm=eq.` y no escribía nada. **El flujo reportó "154 escritas" y en la base no había entrado ninguna.** Dos reglas que salen de acá: los nodos de escritura van en paralelo desde el mismo item, no encadenados; y **el contador de escrituras se cuenta por `statusCode`, nunca por cantidad de items** — con `onError: continue` un fallo también produce item. Aplica a toda la Fase 3 en adelante.
- **El techo de cobertura es 77–85%, no 96% (medido y aplicado 04/09).** El descubridor recupera el 35% de las 442 fuentes rotas, no casi todas. **Quedan ~181 fuentes sin salida por feed**, de las cuales ~126 nunca tuvieron feed y dependen del camino HTML de la Fase 5. La v4 hereda un agujero más chico que el de la v3, pero lo hereda. Cualquier promesa de cobertura al cliente se hace sobre 78–85%.
- **Un `NOT NULL` sin default convierte el camino por default en el camino roto.** `[F4.4]` estuvo tres días dado por hecho porque las mediciones se hicieron con `p_registrar=false` y nadie ejecutó el default. **Regla: toda función con un parámetro que dispara escritura se prueba con sus valores por default, no solo con los que uno usa.** Aplica a `armar_clipping()` y `decidir_nivel()` de la Fase 6.
- **Nada que decida por fecha puede depender de `now()` si se va a reproducir.** ~~Riesgo abierto~~ **aplicado en `[F4.6]`**: la compuerta de antigüedad daba casi el doble de descartes corrida tres días después sobre los mismos datos. Ahora el corte sale de `p_fecha`. **Queda como regla para las Fases 5 y 6:** toda función que compare contra un corte horario recibe el instante, no lo lee del reloj. `decidir_nivel()` y `wf/salud` (umbrales por día de la semana) son las próximas candidatas a caer en lo mismo.
- **El costo de una etapa se mide con el volumen que va a tener, no con el de hoy.** La compuerta anti-repetición era gratis mientras la etapa anterior descartaba casi todo (74 notas la llamaban); apenas `[F4.6]` dejó pasar miles, la corrida de los cuatro clientes murió por `statement timeout`. Aplica directo a la Fase 5: los agentes se van a encontrar con ~5.000 candidatas por cliente, no con las 74 de las pruebas.
- **PostgREST corta las lecturas en 1.000 filas y no avisa** (encontrado el 04/09 en el descubridor: pedía `limit=2000` sobre 1.437 fuentes y recibía 1.000, calculando los pendientes sobre un universo truncado sin que nada fallara). Aplica a **todo flujo v4 que lea una tabla grande por REST** — `medios_fuentes` (1.437), `medios_suscripcion` (2.102). Hay que paginar y hacer que el flujo falle ruidosamente si la última página viene llena. Revisar con este criterio los flujos de medición del 03/09.
- **Techo de memoria por tanda en n8n.** Medido: 35 dominios × ~17 candidatas retienen **21 MB** en el nodo HTTP; 70 dominios matan el proceso. Cualquier flujo que retenga cuerpos HTML tiene que ir por tandas chicas y no pedir dos veces la misma página.
- **Dependencia de un proveedor pago:** el 3% de las fuentes solo entra por Bright Data, que se cobra por request y hoy corre en plan de prueba. Antes de producción hay que dimensionar el costo del volumen real (nueve barridos diarios × cuatro clientes) y decidir si ese 3% lo vale.
- **La estrategia de transporte se desactualiza sola.** Un medio que hoy entra por un proxy puede cambiar mañana. `medios_estrategia` es una foto del 03/09: sin re-verificación periódica (`[F3.6]`) envejece en silencio y el recolector empieza a fallar sin que se note.
- **Configuración del proveedor de proxy:** una de las zonas de la cuenta tiene la IP del servidor de n8n en su lista de bloqueo, y por eso rechazaba todo con 401 aunque la credencial fuera válida. Se resolvió usando otra zona de la misma cuenta, sin tocar la configuración. Queda pendiente entender por qué está ese bloqueo (probablemente explica por qué el nodo equivalente de la v3 quedó apagado y marcado como pendiente).
- **Flujos en vuelo:** nada de la Fase 0 que toque la cuenta compartida se ejecuta sin coordinarlo con el responsable de esa cuenta.
- **Zonas horarias:** se resuelve antes de escribir el recolector. Todo en UTC, se decide en hora local; una fecha sin hora nunca se compara contra un corte horario.
- **Carga de n8n: medida, no estimada.** Un recolector × 9 barridos/día × 1.112 fuentes ≈ **9.250 fetches/día**. Un barrido completo son ~19 tandas y **~3,5 min** de punta a punta, así que las nueve ventanas no se solapan ni cerca. Las tandas van en serie (`batchSize=1`) y la memoria de los cuerpos HTTP queda acotada a una tanda. **Lo que hay que vigilar, ahora que el cron está encendido (07/09):** ~180 ejecuciones/día en la lista, y que la duración por barrido no crezca. **La línea de base es 5m09s** — el barrido del 07/09, 23 tandas, 1.288 fuentes. Si empieza a pasar de ~15 min, algo se degradó.
- **Segundo proxy en producción:** hoy vive en un proyecto de prueba. Decidir dónde vive antes de la Fase 3.
- **Límite de la ejecución manual de n8n:** las corridas con volumen alto mueren si se disparan con el botón (n8n retiene el set completo en memoria para mostrarlo en pantalla). Por webhook, el mismo trabajo pasa. Aplica a cualquier flujo masivo de la v4, no solo a la medición.
- ~~**Drift de migraciones del repo**~~ **resuelto el 07/09.** El repo tenía 41 archivos contra 69 migraciones aplicadas. Eran **28 faltantes** (no 22: la primera cuenta comparaba por número de versión y varias estaban en el repo con otro timestamp — hay que comparar por **nombre**) y **9 renumeradas**. Se bajaron desde `supabase_migrations.schema_migrations`, que guarda el SQL exacto de cada una, así que no hubo transcripción a mano. **Ahora son 69 = 69.** Queda la regla: si se aplica algo sin `db push`, bajar esa migración al repo en la misma sesión — es lo que dejó 28 sueltas.
- **Autor ≠ aprobador:** cada fase que promueve a `public` o activa un workflow necesita revisión de un segundo.
- **Fuera de alcance:** gacetillas, editor web y exportación, clientes en formato legado.

---

## 6. Pendiente al cierre del roadmap

### `[Z.1]` Asegurar el schema `test` — *pospuesto por decisión del 04/09, se revisa al final*

Era `[F0.6]` y quedó fuera al omitir la Fase 0. **No lo abrió la v4 y no lo cierra la v4**, pero conviene que el número esté escrito y no se pierda.

**Medido el 04/09 con la clave pública del front** (la misma que está en el navegador de cualquiera que abra el dashboard):

| Prueba | Resultado |
|---|---|
| `GET test.notes` (solo conteo) | **HTTP 206 · 10.049 filas** |
| `GET public.notes` (control) | **HTTP 401 Unauthorized** |

`public` está protegido; `test` no. Son tres cosas que se suman y hacen falta las tres: `anon` tiene **USAGE** sobre el schema; tiene **SELECT, INSERT, UPDATE y DELETE** en las 28 tablas; y **ninguna tiene RLS**. En Supabase los permisos de tabla dicen *qué operaciones*, y RLS dice *sobre qué filas* — sin RLS, "podés hacer SELECT" significa todas las filas de todos los clientes. En `public` los permisos son los mismos, pero RLS los filtra: por eso el control da 401.

**Y `test` no contiene datos de prueba:**

| | |
|---|---|
| Notas | 10.049 |
| Filas **idénticas a producción** (mismo id) | **9.359 — el 93%** |
| Última nota | 03/09 — se mantiene al día |
| Reportes de calidad del cliente | 439 |
| Perfiles de usuario · accesos | 2 · 16 |

Es un espejo de producción, no un sandbox. El backup congelado tiene el mismo agujero.

**El arreglo son dos migraciones:** activar RLS en las 28 tablas y revocarle a `anon` el borrado. Antes de tocarlo hay que verificar que no se rompe el modo prueba de la v3, que apunta a este schema.
