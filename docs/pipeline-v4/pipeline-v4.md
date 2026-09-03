# Clipping Ketchum · Pipeline v4

**Especificación técnica de ejecución.**
Fecha: 02/09/2026 · Cliente piloto: Booking · Estado: propuesta

**El clipping sale los siete días de la semana, sábados y domingos incluidos.** Verificado contra la base: los cuatro clientes tienen clipping los siete días. No existe día de mantenimiento ni ventana libre — todo lo que se agregue tiene que convivir con un envío diario.

---

## Índice

1. [Qué cambia respecto de hoy](#1-qué-cambia-respecto-de-hoy)
2. [Diagrama general](#2-diagrama-general)
3. [Línea de tiempo: de 00:00 a 07:30](#3-línea-de-tiempo-de-0000-a-0730)
4. [La cadena de scrapeo](#4-la-cadena-de-scrapeo)
5. [Los agentes](#5-los-agentes)
6. [Las notas que no entraron](#6-las-notas-que-no-entraron)
7. [Alertas y manejo de errores](#7-alertas-y-manejo-de-errores)
8. [Modelo de datos](#8-modelo-de-datos)
8b. [El ciclo de vida de un medio](#8b-el-ciclo-de-vida-de-un-medio)
9. [Qué se construye y en qué orden](#9-qué-se-construye-y-en-qué-orden)
10. [Operación: zonas horarias, idempotencia, dedup, modo testeo, rollback](#10-operación-lo-que-hace-que-esto-sobreviva-a-un-martes-cualquiera)
11. [Tier y ad value: el dato que carga el cliente](#11-tier-y-ad-value-el-dato-que-carga-el-cliente)
12. [Lo que está corriendo hoy en n8n](#12-lo-que-está-corriendo-hoy-en-n8n)

---

## 1. Qué cambia respecto de hoy

| | Hoy | v4 |
|---|---|---|
| Cuándo se busca | 7:00 a 7:20, contra reloj | 3 pasadas de noche + 1 caliente antes de cada envío |
| Hasta qué hora cubre | Nadie lo sabe | Corte declarado y escrito en el clipping |
| Medios que se visitan | 359 de 1.905 nunca se miran | Todos, y si falta uno avisa |
| Quién filtra | La IA descarta el 93% | Reglas baratas descartan; la IA ve 20× menos |
| Dónde viven las reglas | JavaScript en 3 nodos × 4 workflows | Filas en una tabla, editables desde la plataforma |
| Por qué no entró una nota | No se sabe | Regla exacta + valor que la disparó, visible en la plataforma |
| Si algo falla | Devuelve vacío y el mail sale roto o no sale | Baja de nivel y sale igual, con aviso |
| Ingesta | Cada cliente scrapea por su cuenta | Una sola, compartida por los cuatro |
| Un arreglo | Hay que aplicarlo 4 veces | Una vez, vale para los 4 |

**Los dos principios de fondo:**

1. **A las 7:30 no se sale a buscar nada.** El clipping ya está decidido, verificado y armado. Lo único que pasa a esa hora es que se manda.
2. **El envío nunca se detiene.** Puede salir peor, nunca puede no salir. Ver §7, escalera de degradación.

---

## 2. Diagrama general

### 2.1 · La ingesta es una sola, los clippings son cuatro

Este es el cambio estructural. Hoy hay cuatro workflows que salen a scrapear por separado, y los medios que comparten (Infobae, Clarín, La Nación están en los cuatro) se visitan cuatro veces. En la v4 la ingesta **no es de nadie**: junta todo en un pool común, dedup por URL canónica, y cada cliente después filtra lo suyo.

```
     INGESTA COMPARTIDA                    ARMADO POR CLIENTE
     ──────────────────                    ──────────────────

  00:00 ─► barrido de los 1.776 dominios
             │  (~360 fallan)
  03:00 ─► reintento SOLO de esos 360
             │  (~90 siguen mal)
  05:30 ─► último intento + cierre de cobertura
             │
             │        + pasada CALIENTE por cliente,
             │          10 min antes de cada corte
             ▼
      ┌──────────────────┐
      │   POOL ÚNICO     │            06:45 ─► Mars    ─┐
      │  candidatas_raw  │ ─────────► 07:00 ─► BMS     ─┤
      │  dedup por URL   │            07:15 ─► Booking ─┼─► 1. plataforma
      └──────────────────┘            07:30 ─► MSD     ─┘   2. mail
```

Cada armado tarda ~4 minutos. Con 15 minutos entre uno y otro nunca se pisan ni compiten por la misma cuota de OpenAI. **Un cliente nuevo es una fila en una tabla y un horario**, no un workflow de 97 nodos.

### 2.2 · El detalle de un armado

*Ejemplo con BMS, que envía 07:00. Para los otros tres, corré todos los horarios 15 minutos.*

```
   NOCHE (ingesta)                    MADRUGADA (decisión)         MAÑANA
   ───────────────                    ────────────────────         ──────

   00:00 ─┐
   03:00 ─┼─► candidatas_raw ──► 06:00 normalización
   05:30 ─┘   (~3.000)                 + dedup
              sin filtrar               + 3 compuertas
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
              ENTRA SÍ O SÍ           NO ENTRA NUNCA            PUNTÚA
           marca/producto del      dominio extranjero      todo lo demás
           cliente, o medio        fecha vieja confiable    suma o resta
           que él eligió           idioma, URL de portada        │
                    │                       │                    │
                    │                       ▼              ┌─────┴─────┐
                    │                   descartes          alto      medio
                    │                   (con motivo)       pasa       │
                    │                       │                │        │
                    └───────────┬───────────┘                │        │
                                │                            │        │
                                ▼                            ▼        ▼
                          06:15  A1 · COMPLETADOR ◄──────────┴────────┘
                                 completa fecha, título,        (~150 notas)
                                 descripción, medio, link
                                        │
                                        ▼
                          06:30  A2 · JUEZ
                                 relevancia · geografía · sección
                                 escala a modelo grande si duda
                                        │  (~55 notas)
                                        ▼
                          06:35  PASADA CALIENTE
                                 solo medios prioritarios
                                        │
                                        ▼
                          06:45  CARRIL EXPRESO
                                 mismas compuertas + A2
                                 sobre ~15 notas · 30 seg
                                        │
                                        ▼
                          06:48  A3 · AUDITOR
                                 ve el clipping COMPLETO
                                 avisa, NO frena
                                        │
                          06:50  CORTE · no se busca más
                                        │
                          06:52  armado + resumen
                                        │
                          06:55  se decide el NIVEL de salida
                                        │
                          06:57  ─────► 1. PLATAFORMA (siempre)
                                        │
                          07:00  ─────► 2. MAIL (desde lo guardado)
```

---

## 3. Línea de tiempo: de 00:00 a 07:30

> **Por qué tres pasadas y no una.** No son tres barridos iguales: son **un barrido y dos reintentos**. Tres motivos concretos:
>
> 1. **El 94% de las fallas son transitorias** — timeout, 502, rate limit, el medio caído diez minutos. Un medio que no contesta a las 00:00 contesta a las 03:00. Hoy, si un medio falla, falla y nunca se vuelve: ahí están los 359 medios que nunca visitamos.
> 2. **Los medios publican de madrugada.** Un solo barrido a las 00:00 se pierde todo lo que sale entre 00:00 y 05:30.
> 3. **No saturar.** 1.776 dominios de golpe es rate limit garantizado y gasto de Bright Data al pedo.
>
> Las pasadas 2 y 3 son baratas: no vuelven a tocar los ~1.400 que ya salieron bien. El costo real es ~2.230 intentos, no 5.328.
>
> *Si se quiere arrancar más simple: dos pasadas (00:00 y 05:00) y se agrega la tercera cuando midamos cuántos siguen fallando. La arquitectura no cambia — la pasada N es la misma llamada con otro filtro.*

### 00:00 · Ingesta, pasada 1

**Qué corre:** WF-2 (orquestador) llamando a WF-2a/b/c (transportes).

Se recorren **los 1.776 dominios únicos**, no las 1.905 suscripciones. Un medio que siguen tres clientes se busca **una vez** y el resultado se reparte. Hoy se busca tres veces.

Cada dominio entra por la estrategia que le funcionó la última vez (ver §4). Concurrencia 20, sin presupuesto de tiempo porque nadie está esperando.

**No se filtra nada.** Todo lo que vuelve se escribe crudo en `candidatas_raw` con su origen, el transporte que lo trajo y el resultado del intento.

- [ ] Cada intento escribe un renglón en `fetch_log`, ande o no
- [ ] Los cuatro estados se distinguen: `ok` · `vacio` · `error` · `no_visitado`

---

### 03:00 · Ingesta, pasada 2

**No es una vuelta completa.** Toca dos grupos:

- Los ~360 que fallaron a medianoche, reintentados **bajando un escalón de transporte** (directo → Bright Data → Jina)
- Los medios marcados como `publica_de_madrugada` en el catálogo, que a las 00:00 todavía no tenían nada

El resto no se toca. Ya salió bien y su contenido no cambió.

**Control de saturación** (aplica a las tres pasadas):

| Límite | Valor | Por qué |
|---|---|---|
| Concurrencia global | 20 | Techo de memoria del worker |
| Concurrencia por dominio | 2 | No golpear al mismo medio |
| Lote de escritura | 25 dominios | Si el workflow muere en el lote 9, los 8 anteriores ya están guardados |
| Timeout por request | 12 s | Hoy son 30 s y ahí se va el presupuesto |

El loop deja de ser un truco. Hoy los `splitInBatches` existen **solo** para resetear el reloj de 60 segundos de los nodos Code. En la v4 el fetch no vive en un nodo Code, así que el lote es lo que debería ser: una unidad de trabajo que se guarda antes de pedir la siguiente.

---

### 05:30 · Ingesta, pasada 3 y cierre de cobertura

Último intento para los que siguen sin responder.

Al terminar se calcula la cobertura del día:

```
cobertura = dominios_visitados / dominios_activos
```

- [ ] Si cobertura < 100% → se registra qué medio faltó y por qué
- [ ] Si cobertura < 90% → **alerta a Slack, 5:45**

---

### 06:25 a 07:20 · Pasada caliente, por cliente

**Por qué existe.** Las tres pasadas nocturnas resuelven *cobertura*, no *frescura*. Sin esta cuarta pasada, el corte quedaría a las 05:30 y una nota publicada 06:40 no entraría — y **hoy sí entra**, porque la ingesta actual corre 7:00-7:20. Sería un retroceso.

Corre **por cliente, 10 minutos antes de su corte**, y solo toca los dominios marcados `prioritario` en el catálogo de ese cliente: exclusivas y grandes de agenda.

| Cliente | Pasada caliente | Carril expreso | Corte | Envío |
|---|---|---|---|---|
| Mars | 06:20 – 06:30 | 06:30 | 06:35 | 06:45 |
| BMS | 06:35 – 06:45 | 06:45 | 06:50 | 07:00 |
| Booking | 06:50 – 07:00 | 07:00 | 07:05 | 07:15 |
| MSD | 07:05 – 07:15 | 07:15 | 07:20 | 07:30 |

**El carril expreso.** Lo que trae la pasada caliente llega *después* de las compuertas y de A2, así que necesita su propio paso o entraría sin filtrar. Es la misma lógica exacta, corriendo sobre ~15 notas en vez de 3.000: mismas compuertas, misma llamada a A2, mismo prompt. **Nunca una regla distinta** — si el carril expreso tuviera criterio propio, tendríamos dos definiciones de "esta nota entra" y volveríamos al problema de hoy.

A1 no corre en el carril expreso: si a una nota caliente le falta la fecha, se descarta con motivo `incompleta_en_caliente` en vez de gastar 2 minutos buscándola. Aparece en la plataforma y se puede subir a mano.

Reglas duras de este tramo, porque atrás viene el envío:

- [ ] Solo RSS y sitemap **directo**. Nada de Bright Data ni Jina.
- [ ] Timeout 8 s. El que no contesta se saltea sin reintento.
- [ ] Presupuesto duro de 10 minutos. Al minuto 10 corta, ande donde ande.
- [ ] Si esta pasada falla entera, el clipping sale igual con lo de la noche (nivel 1)

Esto **no rompe** el principio de que a las 7:30 no se sale a buscar nada: para esa hora ya cerró.

---

### El corte, y qué pasa con lo que llega tarde

El corte **existe hoy también**, pero nadie sabe cuál es. Cuando el cliente pregunta por qué no está tal nota, no hay respuesta posible. En la v4 se declara.

- [ ] El clipping lleva al pie: *"Cubre desde el 01/09 07:00 hasta el 02/09 06:50"*
- [ ] Las notas posteriores quedan en la plataforma con motivo `posterior_al_corte` y su hora exacta

Una nota publicada después del corte toma uno de dos caminos:

| Tipo de medio | Qué pasa |
|---|---|
| Común | Entra **mañana**. La pasada de las 00:00 barre desde el corte anterior, así que se levanta a medianoche. Corrida un día, no perdida. |
| **Exclusiva o mención de marca** | **No espera 24 h.** Dispara un aviso suelto a Slack y a la plataforma, fuera del clipping, apenas aparece. |

El segundo caso es el pedido textual de Fedra del 28/07: *"de las exclusivas no podemos dejar pasar ninguna"*. Para que funcione, la ingesta **no se apaga a las 05:30**: sigue corriendo durante el día en modo liviano, solo sobre los dominios prioritarios, cada 2 horas.

---

### 06:00 · Normalización y compuertas

**Qué corre:** una función de Postgres sobre las candidatas del día. Sin límite de tiempo.

**Paso 1 — Normalizar**

- [ ] Desenvolver redirectores de Google (`google.com/url?...&url=<real>`)
      → *hoy este bug ensucia entre 35% y 55% del histórico anti-repetidos*
- [ ] Normalizar URL **conservando** el identificador del artículo
      → lista blanca: `id`, `p`, `article`, `nota`
      → borrar solo tracking: `utm_*`, `fbclid`, `gclid`, `ref`
      → *hoy se borra todo el query string y las 8 notas de Pulso Turístico colapsan a una*
- [ ] Resolver el dominio real y cruzarlo contra `medios_catalogo`

**Paso 2 — Resolver la fecha (cascada, nunca inventar)**

```
1. Fecha del feed RSS                        → confiable
2. Dato estructurado JSON-LD                 → confiable
3. og:article:published_time                 → confiable
4. Fecha en la URL   /2026/09/nota           → confiable
─────────────────────────────────────────────────────────
Ninguna  →  fecha_confiable = false
         →  NO se descarta por antigüedad
         →  NO se le pone la fecha de hoy
         →  pasa a A1 para que la busque
```

> **Bug que esto arregla:** hoy, cuando no se puede leer la fecha, se pone la de hoy. Verificado: la misma nota de Pulso Turístico quedó guardada con fecha 26, 27 y 28 de agosto en tres clippings distintos. Por eso una nota vieja pasa el filtro de 24h todos los días, para siempre.

**Paso 3 — Deduplicar**

- [ ] Dentro del día y contra el histórico **con la misma regla**
      → *hoy hay dos funciones de normalización con reglas distintas usadas en el mismo proceso*

**Paso 4 — Las tres compuertas**

| Compuerta | Qué hace | Ejemplo |
|---|---|---|
| **Entra sí o sí** | Menciona producto/marca/vocero del cliente, **o viene de un medio marcado como prioritario**. Ninguna regla posterior la puede tumbar. | Una nota que dice *Opdivo* entra aunque hable de deportistas |
| **No entra nunca** | Solo hechos comprobables: dominio en catálogo extranjero, fecha vieja **con fecha confiable**, idioma no español, URL que es portada o sección | `elnuevodia.com`, que es de Puerto Rico |
| **Puntúa** | Todo lo demás suma o resta. Alto pasa, bajo cae, la franja del medio va a la IA | Mencionar competidor suma; portal de empleo resta |

> **La regla de oro:** los descartes duros son sobre **la fuente y los hechos**, nunca sobre el tema. El dominio, la fecha y el idioma se comprueban. De qué habla una nota es interpretación, y ahí un filtro binario se equivoca en las dos direcciones.

**Salida:** de ~3.000 crudas quedan ~150. Y de las ~2.850 que cayeron, **cada una tiene escrito por qué**.

---

### 06:15 · A1 · Completador

Ver §5. Sobre las ~150 que quedaron.

---

### 06:30 · A2 · Juez

Ver §5. Quedan ~55.

---

### 06:50 · A3 · Auditor

Ver §5. **Avisa, no frena.** Su salida es una lista de hallazgos y una repesca de descartes dudosos. Si A3 se cuelga entero, el clipping sale igual en nivel 1.

---

### 07:10 · Armado

- [ ] Ordenar secciones según la tabla del cliente
- [ ] Calcular ad value por medio desde `medios_catalogo`
- [ ] Redactar el resumen del día
- [ ] Guardar en la plataforma

**Desde este momento Fedra ya puede abrir el clipping y editarlo antes de que salga el mail.**

---

### 07:20 · Se decide el nivel de salida

Un nodo determinístico mira qué etapas anduvieron y elige el nivel (§7). No razona, no pregunta, no puede devolver "no salgo".

### 07:25 · Guardado en la plataforma

**Siempre primero, antes del mail.** El orden importa: si el mail falla, el clipping ya está en la herramienta y se reenvía con un botón. Al revés, mandaríamos algo que no quedó registrado en ningún lado.

- [ ] Se guarda el clipping con su `nivel_salida` y el motivo
- [ ] Se guardan las notas que **no** entraron, con la regla exacta que las descartó (§6)
- [ ] Recién acá se marca `listo_para_enviar = true`

### 07:30 · Envío del mail

El mail se arma **leyendo lo que se guardó**, no en paralelo. Es la misma fuente, así que lo que ve el cliente en el mail y lo que ve en la plataforma no pueden diferir.

Si Gmail rechaza: 3 reintentos con backoff, aviso a Slack, y el clipping queda intacto en la plataforma para reenvío manual.

**No existe el camino donde no sale nada.**

---

## 4. La cadena de scrapeo

### El error conceptual que hay que corregir

Hoy hay **una sola columna** que dice `rss`, `sitemap` o `jina`. Ahí conviven dos preguntas independientes:

```
FORMATO (qué le pedimos)            TRANSPORTE (cómo llegamos)
─────────────────────────           ──────────────────────────
rss        feed XML                 directo       HTTP normal
wordpress  /wp-json/wp/v2/posts     proxy propio  Edge Function nuestra, conserva la fecha
sitemap    sitemap-news.xml         jina          renderiza HTML, NO sirve para feeds
html       portada parseada         brightdata    IP residencial, último recurso
```

Un medio puede tener un **RSS impecable** y ser **inalcanzable desde nuestra IP**. Hoy eso se anota como "el RSS no anda" y se abandona el formato, cuando el formato estaba bien.

> **Dato que lo confirma:** el fetch directo falla el **94%** de las veces. De 763 intentos: 484 timeout, 120 nunca intentados, 115 vacíos, **44 ok**. La causa está documentada en el propio código de v3: *la IP de n8n Cloud está null-routeada por la mayoría de los sitios de noticias argentinos* (verificado contra Clarín, La Nación, Infocampo, Motivar, Bichos de Campo).

### Los dos transportes no son intercambiables

**Jina Reader** (`https://r.jina.ai/<url>`) ya está en producción en Booking y BMS, dentro del nodo `Jina Worker`. **Es gratis y funciona sin API key.** Con key sube el límite de requests y habilita un motor más.

El worker corre cuatro motores en carrera y se queda con el primero que devuelve notas:

| Motor | Para qué | Necesita key |
|---|---|---|
| `auto` | Sitios estáticos, rápido | No |
| `browser` | Sitios con JS | No |
| `cf-browser-rendering` | **Cloudflare** | **Sí** |
| `http` directo | Último recurso | No |

*El caso está documentado en el propio código del nodo:* "NO se puede bajar el HTML por cuenta propia, el sitio esta detras de Cloudflare y bloquea a n8n (probado: 0 resultados). Jina SI llega".

**Pero Jina devuelve markdown, no el archivo original.** Si le pedís un feed, te lo convierte a texto y hay que sacar los links con regex: **se pierde la fecha del feed**, que es justo el dato que arregla el bug de las notas viejas. Jina sirve para páginas HTML, no para feeds.

### feed2json.org — probado y descartado como escalón general

En el nodo `Fetch All Sources` de Booking:

```js
const u = 'https://feed2json.org/convert?url=' + encodeURIComponent(feedUrl);
```

*Comentario del propio nodo:* "[Cliente 2026-07] Monitoreados suelen estar tras Cloudflare que bloquea la IP de n8n -> rss2json (proxy gratis) PRIMERO: rapido (~100ms) y sortea el bloqueo."

Hoy corre **antes** que el fetch directo, y solo para los medios con etiqueta `SITIO MONITOREADO`. Si devuelve items, corta ahí.

Técnicamente hace lo que promete: devuelve el feed parseado a JSON (`items`, `url`, `summary`, `date_published`) y **conserva la fecha**. Medido: 654 de 654 items con fecha, fidelidad idéntica al directo en Clarín, Infobae y La Nación.

**Pero no sirve a esta escala.** Probado el 02/09/2026 hasta agotar la cuota:

```
HTTP 429
Conversions limited to 50 per hour.
Please don't use this service for production.
```

| Qué | Dato medido |
|---|---|
| Límite | **50 conversiones por hora, por IP** |
| Al pasarse | HTTP 429 con ese mensaje |
| Cabecera `deprecation: true` | **El dominio .org está deprecado** |
| Sucesor (`toptal.com/developers/feed2json`) | **Mismo límite de 50/hora** |
| Falla donde el directo funciona | 5 de 38 (13%) |

**Ya está roto en producción y nadie lo ve.** Los cuatro clippings corren entre 06:45 y 07:41, desde la misma IP de n8n, dentro de la misma hora:

| Cliente | Medios monitoreados con RSS |
|---|---|
| Booking | 66 |
| BMS | 56 |
| MSD | 54 |
| Mars | 39 |
| **Total en la misma ventana de una hora** | **215** |

Contra un límite de 50. **El 77% de las llamadas recibe 429**, y el que corre primero se lleva toda la cuota. No es catastrófico porque el código cae al fetch directo, pero el 429 se traga en un `catch` que devuelve lista vacía: hoy feed2json casi no aporta nada y no hay forma de enterarse.

*Verificado en el código de Booking. En Mars y MSD no está confirmado.*

**Decisión: fuera del diseño.** Un servicio deprecado, con 50 requests/hora y un cartel explícito de "no usar en producción", no puede sostener 1.776 feeds — cubre el 4% de lo necesario. El segundo escalón para feeds bloqueados pasa a ser **un proxy propio** (ver más abajo).

- [ ] Sacar `fetchRss2Json` de los flujos actuales, o al menos loguear el 429 en vez de tragarlo

### El transporte propio: por qué no hay servicio gratis que sirva

Antes de decidir, se probaron todos los candidatos públicos (02/09/2026):

| Servicio | Resultado |
|---|---|
| feed2json.org | **Deprecado** + 50/hora |
| toptal (su sucesor) | 50/hora |
| rss2json.com | **77 de 90 requests → 429.** Pide API key |
| allorigins | **522, caído** |
| codetabs | **522, caído** |
| corsproxy.io | 401, ahora pide key |
| morss.it | Timeout a los 25 s |
| thingproxy | **El dominio no resuelve** |
| cors.workers.dev | 429 a la primera |

**No es que no apareció el bueno: no existe, y por una razón estructural.** Convertir XML a JSON son veinte líneas de código; eso no es el valor. Lo que hace falta es **una IP que no sea la nuestra y ancho de banda**, y eso cuesta plata. El que lo regala o lo limita, o se cae, o cierra.

La conclusión es que **el transporte lo tenemos que tener nosotros**.

### Prototipo medido: Edge Function propia

Deployada y probada en el proyecto Supabase `tufgbajqgjkwqwskkcam` (proyecto de prueba, no toca nada de Ketchum): función `fetch-proxy`, ~150 líneas.

| Qué | Resultado medido |
|---|---|
| Feeds resueltos | **30 de 38** |
| Items con fecha | **551 de 551 (100%)** |
| Velocidad | 200 requests en 2,7 s = **74 req/s, cero 429** |
| Los 5.328 requests de un día | **1,2 minutos de reloj** |
| Latencia | p50 260 ms · p90 302 ms · p99 426 ms |

**El límite real no son las invocaciones, es el egress.** El plan gratis de Supabase da 500.000 invocaciones/mes (necesitamos 160.000) pero solo **5 GB de egress**. El feed de Infobae pesa 952 KB: devolviendo XML crudo son **15,8 GB/mes** y no entra.

**Por eso la función parsea en vez de proxear.** Lee el feed del lado del proxy y devuelve solo lo que el clipping usa:

| | Crudo | Parseado |
|---|---|---|
| Egress de la prueba (38 feeds) | 3.665 KB | **286 KB** |
| Reducción | — | **92,2%** |
| Proyección mensual | 15,8 GB | **1,23 GB** |

Y como el parseo pasa del lado del proxy, **la fecha del feed no se pierde** — que es exactamente lo que sí pasa con Jina.

**Devuelve diagnóstico separado del contenido**, que es lo que pide §4:

```json
{ "ok": true, "diagnostico": "ok", "formato": "rss",
  "upstream_status": 200, "total": 10, "con_fecha": 10, "items": [...] }
```

Diagnósticos de la corrida: `ok` 30 · `bloqueado` 4 · `sin_items` 2 · `timeout` 1 · `no_existe` 1. **Un 403 ya no se confunde con "el feed está vacío".**

### Dos salidas, no una: el hallazgo central

Se deployaron y midieron **las dos** plataformas contra los mismos 38 feeds:

| Plataforma | IP de salida | Red | Estado |
|---|---|---|---|
| Cloudflare Worker | `2a06:98c0:3600::103` | Cloudflare | `ketchum-fetch-proxy.hola-e13.workers.dev` |
| Supabase Edge Function | `18.228.15.182` | AWS São Paulo | proyecto de prueba |

**Ninguna gana sola.** Cada medio arma su propia lista de redes bloqueadas y no se parecen entre sí:

| Medio | RSS directo | Cloudflare | AWS |
|---|---|---|---|
| Infobae | ✓ | **403** | ✓ |
| `mundiario.com` | ✓ | ✓ | **403** |
| `trt.com.ar` | ✓ | ✓ | **403** |
| `el1digital.com.ar` | ✓ | ✓ | **403** |
| `diariotag.com` | ✓ | ✓ | **403** |

*El 403 de Infobae a Cloudflare se verificó 3 veces sobre 2 secciones distintas: consistente.*

Y la primera columna importa: **desde una conexión normal andan todos**. El bloqueo no es al scraping, es a los datacenters, y cada sitio elige a cuál.

**Resultados medidos:**

| | Cloudflare solo | AWS solo | **Combinado** |
|---|---|---|---|
| Resueltos de 38 | 33 | 30 | **34** |
| Items | 578 | 551 | **638** |
| Con fecha | 578 (100%) | 551 (100%) | **638 (100%)** |
| Egress ahorrado | 90,8% | 92,2% | — |

Los 4 que no resuelve nadie **no son problema de bloqueo**:

```
montemaizmira.com.ar   sin_items   el feed esta vacio de verdad
a1noticias.com.ar      sin_items   idem
reconquista.gob.ar     timeout     el sitio esta caido
pagina12.com.ar        no_existe   la URL de nuestro catalogo esta mal
```

**Ninguno de los 38 necesitó Bright Data.**

### Lo que esto valida del diseño

El catálogo guarda **qué transporte funcionó para cada dominio**. No se elige uno global: se prueba, se anota, y al día siguiente cada medio entra por donde le anduvo.

```
medios_catalogo
  infobae.com      transporte = aws         (cloudflare da 403)
  mundiario.com    transporte = cloudflare  (aws da 403)
  clarin.com       transporte = directo     (nadie lo bloquea)
```

Sin esa tabla, cualquier decisión global pierde medios. Con ella, el sistema converge solo.

**Consecuencia para otra decisión:** el EC2 self-hosted de Archytas es AWS, así que ve lo mismo que la Edge Function: entra a Infobae, no entra a los otros cuatro. Migrar n8n a la VM ayuda pero no reemplaza a Cloudflare.

Límites del plan gratis de Cloudflare Workers: **100.000 requests/día** (necesitamos ~5.300), 10 ms de CPU por invocación (el fetch no cuenta como CPU, solo el parseo), 50 subrequests (usamos 1). Supabase: 500.000 invocaciones/mes y 5 GB de egress — con el parseo quedan en 1,3 GB.

### Qué se paga y qué no

**Nada de esto agrega una factura.** Y una aclaración sobre el nombre: le decimos "AWS" al proxy de Supabase porque *es lo que ve el medio del otro lado* — Infobae mira la IP y reconoce un datacenter de Amazon. Pero **Archytas no tiene cuenta de AWS ni factura de Amazon**: Supabase alquila servidores allá y arma su producto encima. La relación comercial es con Supabase.

| Escalón | Plan | Incluye | Necesitamos |
|---|---|---|---|
| Directo | — | — | — |
| Cloudflare Workers | Gratis | 100.000 req/día | ~5.300/día |
| Supabase Edge Functions | Gratis | 500.000 inv/mes · 5 GB egress | ~160.000 · 1,3 GB |
| Bright Data | USD 1,50/1.000 | 5.000 gratis/mes | **0 en la prueba** |

Supabase ya lo tenemos en los cuatro clientes; la función es un archivo más dentro de un proyecto existente. Cloudflare es cuenta nueva, plan gratis, creada el 02/09/2026 con `Hola@archytas.io`.

### Dónde vive cada pieza

| Pieza | Estado | Ubicación |
|---|---|---|
| Worker de Cloudflare | **Deployado y andando** | `ketchum-fetch-proxy.hola-e13.workers.dev` |
| Edge Function de AWS | Deployada, **en proyecto de prueba** | `tufgbajqgjkwqwskkcam` |
| Código de ambos | Versionado | `prototipos/cloudflare-worker/` |

**Decisión pendiente: dónde vive la Edge Function en producción.**

- *En el proyecto de Ketchum* — más simple, pero el egress del proxy compite con el del dashboard.
- *En un proyecto aparte compartido por los cuatro* — **recomendado**. La ingesta ya es compartida (§2.1), así que el transporte también debería serlo, y aísla el consumo.

Se puede cambiar después sin costo.

### Seguridad: los dos proxies están cerrados

Ambos exigen autenticación y está verificado — sin credencial devuelven 401.

| Proxy | Auth | Credencial en n8n |
|---|---|---|
| Cloudflare | `X-Api-Key` (secret propio) | `Ketchum — Fetch Proxy (Cloudflare)` · `PKPV9bTP9T8wZAHJ` |
| AWS | `Authorization: Bearer` (`verify_jwt`) | `Ketchum — Fetch Proxy (AWS/Supabase)` · `7OwKt737r1MWbn7d` |

Las dos viven en **Credentials de n8n**, nunca en un nodo Set — que es el error que sí existe hoy con las keys de Jina, OpenAI y Bright Data en el nodo `GSID`.

- [ ] Pasar la key de Cloudflare (hoy en `~/.archytas-ketchum-proxy.key`, permisos 600, una sola máquina) **al gestor de contraseñas del equipo**
- [ ] Regenerar la API key de Bright Data expuesta en `GSID`

### Jina: sirve, pero no para feeds

Probado con cinco formas de pedirle contenido crudo — `x-return-format: text`, `: html`, `x-respond-with: text`, `: html`, streaming. **Ninguna devuelve el XML**: todas pasan por su parser. Si le pasás un RSS, te da markdown y perdés las fechas.

Donde es la mejor herramienta que tenemos es en **páginas HTML**, y la key paga habilita `cf-browser-rendering`, el motor que pasa Cloudflare. Eso no lo reemplaza ni el proxy propio ni Bright Data.

### Los cuatro transportes, y cuándo va cada uno

| Transporte | Costo | Preserva la fecha | Para qué sirve |
|---|---|---|---|
| Directo | — | Sí | Todo lo que no esté bloqueado |
| **Proxy Cloudflare** | **Gratis** | **Sí** | **Feeds bloqueados. Resuelve 33 de 38** |
| **Proxy AWS** (Supabase) | **Gratis** | **Sí** | **Los que bloquean Cloudflare, como Infobae** |
| Jina Reader | Ya pago | **No** | Páginas HTML con JS o Cloudflare. **Nunca feeds** |
| Bright Data | USD 1,50/1.000 | Sí | Último recurso. En los 38 no hizo falta ninguna vez |

**Orden por formato:**

```
formato = rss | wordpress | sitemap        formato = html
  1. directo                                 1. directo
  2. proxy cloudflare   ← gratis             2. jina          ← ya pago, renderiza
  3. proxy aws          ← gratis             3. brightdata    ← IP residencial
  4. brightdata         ← ultimo recurso
  (nunca jina: rompe la estructura)
```

**La regla de fondo:** un transporte del que dependemos tiene que ser nuestro o tener contrato. Nunca un servicio gratuito de tercero sin SLA — eso es exactamente lo que pasó con feed2json.

### Descubrimiento de estrategia

```
para dominio SIN estrategia conocida, o con 2 fallos seguidos:

  para formato in [rss, wordpress, sitemap, html]:

      r = intentar(formato, transporte=directo)

      si r.diagnostico in [timeout, 403, 401, cloudflare]:
          # el transporte según el formato, no siempre el mismo
          r = intentar(formato, transporte=brightdata)   ← MISMO formato, otra IP

      si r.diagnostico == "200 sin artículos":
          r = intentar(formato, transporte=jina)         ← necesita renderizar JS

      si r.articulos > 0:
          guardar(formato, transporte, url_recurso)
          CORTAR

  si nada funcionó:
      última red → Google News  site:dominio
      marcar "sin estrategia" y avisar
```

**La regla que hoy no existe:** cuando el directo falla por timeout o bloqueo, se reintenta **el mismo formato por otra IP** antes de cambiar de formato. Hoy el sistema cambia de formato, que es justamente lo que no había fallado.

### Cómo se descubre el feed

```
1.  GET /  →  buscar <link rel="alternate" type="application/rss+xml">
2.  Rutas conocidas: /feed  /rss  /rss.xml  /atom.xml  /index.xml  /?feed=rss2
3.  WordPress: /wp-json/wp/v2/posts?per_page=30&_fields=title,link,date,excerpt
4.  Sitemaps: /sitemap-news.xml  /news-sitemap.xml  /sitemap_index.xml
5.  Jina sobre el home, extrayendo links que parezcan notas
6.  Bright Data sobre el home, ídem
```

> **La API de WordPress es la oportunidad que no estamos usando.** Muchos medios chicos y de nicho argentinos corren WordPress y exponen `/wp-json/wp/v2/posts` por defecto: JSON limpio con título, link, fecha y extracto, sin parsear HTML y **sin el tope de 10 o 20 items** que tienen los feeds. Es una prueba HTTP por medio y hoy no se hace en ninguno de los cuatro workflows.

### Diagnóstico de fallas: qué se prueba según cómo rebotó

| Síntoma | Diagnóstico | Acción |
|---|---|---|
| DNS no resuelve | El dominio murió | Baja del catálogo + avisa |
| **Timeout de conexión** | **Nuestra IP está bloqueada** | **Bright Data.** El caso más común. |
| 403 · 401 | Bloqueo por firewall o user-agent | Bright Data |
| 429 | Vamos muy seguido | Esperar. **No escalar.** |
| 404 en el feed | Cambió la URL del feed | Redescubrir |
| 200 + "Just a moment" | Cloudflare pidiendo JS | Bright Data |
| 200 sin artículos | Contenido armado por JS | Jina, después Bright Data |
| 200 + feed válido + 0 items | No hubo novedades | **Nada. No es falla.** |
| 200 + feed válido + todo viejo | Feed abandonado | Avisar, bajar prioridad |
| Certificado vencido | Descuido del medio | Reintentar sin verificar + avisar |

### Aprendizaje continuo

```
medio_estrategia
  dominio_norm · formato · transporte · url_recurso
  funciona_desde · ultimo_ok · fallos_consecutivos · ultimo_diagnostico

- Cada día se arranca por la estrategia guardada
- 2 fallos seguidos → se corre el descubridor completo
- Si el transporte es brightdata → 1 vez por semana se re-testea el directo
  (por si el medio volvió a permitirnos, y así bajamos el costo solo)
```

### Costo

Bright Data Web Unlocker: **USD 1,50 por cada 1.000 requests**, concurrencia ilimitada, 5.000 gratis por mes.

**Los dos proxies propios son gratis y entre los dos resolvieron 34 de 38 feeds.** A Bright Data no llegó ninguno: los 4 restantes son feeds vacíos, un sitio caído y una URL mal cargada en nuestro catálogo. La tabla de abajo queda como **techo teórico**, no como costo esperado. El costo real del transporte, sobre lo medido, es **cercano a cero**.

| Escenario (techo, si Bright Data hiciera todo) | Requests/mes | Costo |
|---|---|---|
| 1.776 dominios × 1 vez por día | 53.000 | USD 80 |
| 1.776 dominios × 3 pasadas por día | 160.000 | USD 240 |
| Solo los que fallan por directo (~94%) | 50.000 | USD 75 |

---

## 5. Los agentes

### Cuántos son

**Cuatro, pero solo tres corren todos los días.**

| Agente | Cuándo | Sobre qué | Puede frenar |
|---|---|---|---|
| **A0 · Descubridor** | Todos los días 09:30 | Medios, no notas | No |
| **A1 · Completador** | 06:15 | Solo las notas incompletas (~30 de 400) | No |
| **A2 · Juez** | 06:30 | Todas las que pasaron las compuertas | No |
| **A3 · Auditor** | 06:50 | El clipping ya armado | No |

**A0 está separado a propósito.** No mira noticias, mira medios. Agarra los dominios que vienen fallando y prueba formas de entrar que hoy no probamos:

- ¿Tiene un RSS que no está en el catálogo? (busca `<link rel="alternate">`, prueba `/feed`, `/rss`, `/index.xml`)
- ¿El WordPress está abierto en `/wp-json/wp/v2/posts`?
- ¿Hay sitemap, y trae fechas?
- ¿Anda por Bright Data cuando directo rebota?

Cuando encuentra una que funciona la escribe en el catálogo, y **el barrido de esa misma noche ya la usa**.

Es lo que va a recuperar los 359 medios que hoy nunca visitamos. Y no es un trabajo de una vez: los medios cambian de CMS, ponen Cloudflare, migran de dominio. Es mantenimiento permanente.

**Corre 09:30, todos los días, sobre 30 dominios.** No los domingos: el clipping sale los siete días y no existe el día muerto. A esa hora ya salieron los cuatro y no corre nada más hasta las 23:00, así que puede tomarse dos horas sin competir con nadie. En lote chico y diario, los ~360 rotos se recorren en doce días; semanal serían tres meses.

**El que hace la fuerza es A2.** A1 solo toca lo que está roto — en un día normal son 20 o 30 notas de 400, no todas.

### Quién arma el clipping

**Nadie. Es código.**

Ordenar por sección, agrupar, calcular ad value, armar el HTML: eso es determinístico y tiene que serlo. Si el armado lo hace un LLM, dos corridas del mismo día dan dos clippings distintos y **no se puede testear nada** — se pierde el golden harness, que es lo único que nos deja cambiar el sistema sin romperlo.

Los agentes deciden **qué entra**. El código decide **cómo se ve**.

### Por qué tres jueces y no seis

Pensé en separar un agente por chequeo: uno para la fecha, uno para el título, uno para la descripción, uno para geografía. **No conviene**, y el motivo es concreto:

- La **fecha, el título y la descripción** se resuelven *yendo a buscar el dato*, no razonando. Son **un agente con herramientas**, no tres jueces.
- La **relevancia, la geografía y la sección** se deciden *leyendo el mismo texto*. Separarlas en tres llamadas es pagar tres veces por leer la misma nota, y hace que dos notas parecidas se decidan distinto.

La división correcta es por **tipo de trabajo**: uno que completa, uno que juzga, uno que audita.

---

### A1 · Completador
**Tipo:** agente con herramientas · **Corre:** 06:15 · **Sobre:** ~150 notas

Detecta qué información falta y **sale a buscarla**. Solo llama a la herramienta que hace falta.

```
DISPARADOR                      HERRAMIENTA Y QUÉ HACE
──────────────────────────────  ─────────────────────────────────────────
fecha_confiable = false      →  abrir_nota()
                                JSON-LD, og:published_time, fecha en el texto
                                devuelve fecha + de dónde salió

descripción vacía o < 60     →  abrir_nota()
                                og:description, primer párrafo del artículo
                                ► LIMPIA etiquetas <a>   ← bug reportado en MSD

título truncado o duplicado  →  abrir_nota()
                                og:title o el <h1>
                                quita el sufijo del medio ("Nota | El Diario")

descripción == título        →  abrir_nota() y buscar el copete real

descripción de OTRA nota     →  abrir_nota() y reemplazar   ← bug reportado

link no responde             →  verificar_link()
                                si 404 → descarta con motivo "link roto"

medio no identificado        →  resolver_medio()
                                desenvuelve redirectores de Google
                                cruza el dominio contra medios_catalogo
```

**Salida por nota:**
```json
{
  "id": 4821,
  "fecha": "2026-09-02",
  "fecha_origen": "json_ld",
  "titulo": "...",
  "descripcion": "...",
  "medio": "Consenso Salud",
  "completado": ["descripcion", "fecha"]
}
```

**Regla dura:** si después de completar sigue faltando el título o el link, la nota **no se descarta en silencio**. Pasa marcada como incompleta y el auditor decide.

---

### A2 · Juez
**Tipo:** modelo con salida estructurada · **Corre:** 06:30 · **Lotes de 12**

**Entrada:**
- Las 12 notas ya completas
- El **prompt del cliente**, leído de `client_prompts` (versionado, editable desde la plataforma: productos, marcas, competidores, qué considerar relevante)
- La lista de secciones del cliente, leída de la tabla

**Salida, una por nota:**
```json
{
  "id": 4821,
  "relevante": true,
  "es_local": true,
  "seccion": "Productos BMS",
  "confianza": { "relevante": 0.94, "es_local": 0.71, "seccion": 0.88 },
  "motivo": "aprobación ANMAT de Opdivo para melanoma"
}
```

**Escalado a modelo grande si:**
- Cualquier confianza < 0.80
- La nota viene de un medio marcado como **prioritario**
- El puntaje determinístico quedó en la franja del medio

En la segunda pasada se manda la nota **completa**, no solo el resumen.

> ### ⛔ Restricción que protege lo que el cliente eligió
>
> **El juez NO puede descartar** una nota que:
> - venga de un medio marcado como prioritario, o
> - mencione un producto o marca del cliente
>
> Sobre esas **solo decide la sección**.
>
> Es la regla que Fedra escribió el 28/07: *"de las exclusivas no podemos dejar pasar ninguna"*. Hoy la IA descartó **185 notas en una semana** de dos medios de nicho que ella misma cargó (`curecompass` y `pharmabiz`), más 77 que descartaron las reglas. Total: **262 notas de dos medios en 7 días**.

El campo `motivo` no es decorativo: es lo que se le muestra a Fedra en la plataforma cuando pregunta por qué entró o no entró una nota.

---

### A3 · Auditor
**Tipo:** determinístico + modelo · **Corre:** 06:50 · **Sobre:** el clipping armado

Es el único que ve **el conjunto**, no nota por nota. Por eso detecta lo que hoy llega al cliente.

**Chequeos duros — no frenan el envío, disparan corrección automática**

Cuando uno de estos falla, la nota culpable **se saca del clipping** y el clipping sale sin ella. Sacar una nota mala es una operación segura; frenar el envío entero no lo es.


- [ ] Toda nota tiene título, descripción, link y fecha
- [ ] Ningún link devuelve 404 (muestreo de 10)
- [ ] Ninguna fecha fuera de ventana **con fecha confiable**
- [ ] Ningún título repetido dentro del clipping
- [ ] Ninguna descripción repetida entre dos notas ← *bug reportado*
- [ ] Ninguna descripción contiene HTML ← *bug reportado*
- [ ] Ningún dominio del catálogo de extranjeros
- [ ] Toda sección existe en la tabla del cliente
- [ ] Todas las notas precargadas por el cliente están presentes

**Chequeos blandos — avisan, no frenan**

- [ ] Volumen dentro de ±40% del promedio del cliente **para ese día de la semana**
- [ ] Ninguna sección vacía si históricamente tiene notas
- [ ] Ningún medio aporta más del 30% del clipping

**Revisión con modelo**

Se le pasa el clipping entero:
- ¿Hay dos notas que son la misma noticia con distinto título?
- ¿Alguna descripción no corresponde a su título?
- ¿Alguna nota está claramente en la sección equivocada?

**Salida:**
```json
{
  "estado": "ok" | "con_avisos",
  "notas_a_quitar": [ 4821, 4903 ],
  "notas_a_repescar": [ 4877 ],
  "hallazgos": [ { "tipo": "...", "nota_id": "...", "detalle": "..." } ]
}
```

No existe `"bloqueado"`. El auditor **no tiene la palabra "no"** en su vocabulario.

**Repesca.** Además de auditar, A3 mira los descartes que quedaron con score entre 0.4 y 0.6 y decide si alguno merecía entrar. Es la red de contención del pedido de Fedra sobre las exclusivas: *"de las exclusivas no podemos dejar pasar ninguna"*.

---

## 6. Las notas que no entraron

**Esto es lo que hoy no existe y es lo que más cambia el día a día del equipo.**

Cada nota que se cae en cualquier etapa se guarda con su motivo, y **sube a la plataforma**.

### Qué se guarda

```
descartes
  candidata_id
  etapa              normalizacion | compuerta | juez | auditor
  regla_id           qué regla la mató (null si fue la IA)
  valor_que_matcheo  "deportistas"     ← qué disparó exactamente
  puntaje_final      -3
  explicacion        "resta por patrón deportivo, sin señal de marca"
  medio · titulo · url · fecha
  recuperable        true si el equipo la puede subir con un clic
```

### Cómo se ve en la plataforma

Sobre la pestaña **Actividad**, que ya existe:

```
┌─────────────────────────────────────────────────────────────────┐
│  Notas que no entraron hoy                    Booking · 02/09   │
│                                                                  │
│  Filtrar:  [ Todas ▾ ]  [ Por medio ▾ ]  [ Por motivo ▾ ]       │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Consenso Salud · 02/09                          [ Subir ]  │ │
│  │ "Resistencia antimicrobiana: el acceso a..."               │ │
│  │                                                             │ │
│  │ ✕ No entró por: REGLA #47 · patrón en título               │ │
│  │   Coincidió con: "antibióticos"                            │ │
│  │   Etapa: compuerta determinística                          │ │
│  │                                    [ Ver regla ] [ Editar ] │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ El Cronista · 02/09                             [ Subir ]  │ │
│  │ "Un estudio alerta por el impacto de Airbnb..."            │ │
│  │                                                             │ │
│  │ ✕ No entró por: sección extranjera en la URL               │ │
│  │   Coincidió con: "/espana/"                                │ │
│  │   Etapa: compuerta determinística                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Pharmabiz · 02/09                               [ Subir ]  │ │
│  │ "ANMAT: alerta para retatrutide"                           │ │
│  │                                                             │ │
│  │ ✕ No entró por: la IA la consideró poco relevante          │ │
│  │   Confianza: 0.62  (baja)                                  │ │
│  │   Motivo: "regulatorio sin mención de marca del cliente"   │ │
│  │   Etapa: A2 · juez                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Qué pasa cuando el equipo aprieta "Subir"

1. La nota se agrega al clipping del día, en la sección que elijan
2. Se registra que **esa regla se equivocó**
3. La regla suma un punto en su contador de errores
4. Si una regla acumula 3 errores, **aparece marcada para revisar** en la pantalla de Reglas

Eso convierte cada corrección del equipo en información, en vez de en trabajo perdido.

> **Contexto:** hoy hay **570 correcciones** reportadas entre el 14/08 y el 02/09 que no alimentan nada. El ticket que creó la pestaña de reportes decía textualmente que servía *"para que el equipo técnico lo revise, lo corrija y ajuste la configuración base para que no se repita"*. La primera mitad se construyó; la segunda no.

### La pantalla de Reglas

```
┌──────────────────────────────────────────────────────────────────┐
│  Reglas de filtrado                            Todos los clientes│
│                                                                   │
│  #   TIPO           VALOR             DESCARTÓ  ERRORES  ESTADO   │
│  ──────────────────────────────────────────────────────────────   │
│  12  dominio        elnuevodia.com       47        0     ✓ activa │
│  47  patrón título  antibióticos          9        3     ⚠ revisar│
│  51  sección URL    /espana/              8        0     ✓ activa │
│  63  patrón título  deportistas          12        5     ⚠ revisar│
│                                                                   │
│  [ + Nueva regla ]                    [ Ver propuestas (3) ]      │
└──────────────────────────────────────────────────────────────────┘
```

Una regla que descartó 47 notas y no generó ni un reclamo, sirve.
Una que descartó 12 y 5 fueron reclamadas, **hay que sacarla**.

Hoy no se puede saber eso de ninguna regla.

---

## 7. Alertas y manejo de errores

### Los dos principios, que parecen contradecirse y no

> **1. Una etapa que no puede hacer su trabajo falla y avisa. Nunca devuelve vacío en silencio.**
> **2. El envío de las 7:30 nunca se detiene.**

La forma de sostener las dos: **una etapa que falla no frena el tren, lo baja de categoría.** El aviso es fuerte y va a Slack; el mail sale igual, en un nivel peor, y el nivel queda escrito en la plataforma.

### La escalera de degradación

A las **07:20** un nodo determinístico elige el nivel más alto que las etapas disponibles permiten.

| Nivel | Qué se cayó | Qué sale | Lo nota el cliente | Aviso |
|---|---|---|---|---|
| **0** | Nada | Clipping completo, auditado, con valorización | — | — |
| **1** | Auditor, ad value o resumen | Todo menos ese dato | No | Slack, sin urgencia |
| **2** | A2 · Juez (429, timeout, basura) | Solo el filtro determinístico | Más ruido del habitual | **Slack 06:45** |
| **3** | Ingesta vacía o pool sin notas | El clipping de ayer, **marcado como tal** | Sí, y está bien que lo note | **Llamado al on-call** |

**Nivel 2 en detalle.** Sin el juez, pasan todas las notas que superaron las compuertas determinísticas. Son más y hay ruido, pero **no falta ninguna**, que es el error caro. Fedra prefiere borrar diez notas de más que descubrir a las 10 de la mañana que faltó la nota de Clarín.

**Nivel 3 en detalle.** Mandar el de ayer marcado como *"no pudimos generar el de hoy"* es feo. Es infinitamente mejor que el silencio, porque el equipo se entera **a las 7:30**, no a las 10 cuando pregunta el cliente. El mail lleva un banner arriba y no se guarda como clipping válido del día.

### Cortafuegos de OpenAI

Hoy un 429 dispara reintentos que empeoran el 429. En la v4:

- Tope de tokens por cliente por día, configurable desde la plataforma
- Ante 429: **un** reintento con backoff. Si vuelve a fallar, se baja a nivel 2. No hay loop.
- El tope se calcula sobre el consumo real de los últimos 30 días, no es una constante escrita a mano

Hoy es al revés: casi todos los nodos tienen `continueOnFail` y devuelven lista vacía cuando algo sale mal. Por eso el workflow nunca se pone en rojo, y por eso **perder datos y tener un día tranquilo se ven exactamente igual**.

*Evidencia: MSD tuvo un día con cero notas enviadas y nos enteramos buscándolo en la base semanas después.*

### Tabla de fallas

| Falla | Qué hace el sistema | Aviso |
|---|---|---|
| Un medio no responde en las 3 pasadas | Sigue. Marca el medio y baja su estrategia. | Pantalla de salud |
| Más del 10% de medios sin visitar | Sigue, pero avisa fuerte | **Slack · 5:45** |
| Falla la normalización | Nivel 2. Pasan las compuertas duras solamente. | **Slack · inmediato** |
| A1 no puede completar una nota | Sigue. La nota pasa marcada como incompleta. | El auditor la levanta |
| A2 falla o devuelve basura | 1 reintento. Si falla otra vez: **nivel 2**. | **Slack · 6:45** |
| El auditor rompe un chequeo duro | Saca esa nota. El clipping sale sin ella. | **Slack · 6:55** |
| El auditor no responde | Nivel 1. Sale sin auditar. | **Slack · 6:55** |
| El pool está vacío | **Nivel 3.** Sale el de ayer, marcado. | **Llamado al on-call** |
| Gmail rechaza el envío | Reintenta 3 veces. El clipping queda igual en la plataforma. | **Slack · inmediato** |

### Formato del aviso a Slack

```
🟡 Booking · clipping del 02/09 sale en NIVEL 1

El auditor sacó 4 notas y el clipping sale igual a las 7:30.

  • 3 notas sin descripción → quitadas
    Consenso Salud, Pharmabiz, El Cronista
  • 1 título repetido → quitada la segunda
    "ANMAT actualiza el listado de..."

Quedan 47 notas. Tenés 35 minutos para revisarlo.

[ Ver clipping ]   [ Reponer las quitadas ]   [ Ver detalle ]
```

### Umbrales que se aprenden solos

No son constantes escritas a mano: se calculan sobre el histórico del cliente, **separado por día de la semana**.

Esto no es un refinamiento, es obligatorio. El fin de semana el volumen baja fuerte y un umbral global daría falsa alarma todos los domingos:

| Cliente | Promedio Lun-Vie | Domingo | Diferencia |
|---|---|---|---|
| BMS | 52.4 | 29.3 | **−44%** |
| Booking | 56.0 | 43.0 | −23% |
| Mars | 85.5 | 76.3 | −11% |
| MSD | 29.3 | 22.3 | −24% |

*Medido sobre los últimos 56 días, notas incluidas por clipping.*

Con un umbral global de ±40%, **BMS dispararía alerta todos los domingos**. A la tercera semana nadie mira más las alertas, y ahí perdimos la herramienta entera. La comparación siempre es domingo contra domingos.

```
volumen_esperado    = mediana de los últimos 14 días
alerta si           volumen < 60% del esperado
                    o volumen > 160% del esperado

cobertura_esperada  = 100%
alerta si           < 90%

medios_mudos        = alerta si un medio lleva más de N días sin traer nada
                      N = 3 × su ritmo de publicación medido
```

---

## 8. Modelo de datos

```
medios_catalogo            ← GLOBAL: un dominio existe una sola vez
  dominio_norm (PK)
  nombre · pais · tier · alcance · ad_value
  ritmo_publicacion_semanal        medido, define cada cuánto visitarlo

medios_estrategia          ← cómo entramos, aprendido
  dominio_norm (PK)
  formato        rss | wordpress | sitemap | html
  transporte     directo | jina | brightdata
  url_recurso
  funciona_desde · ultimo_ok · fallos_consecutivos · ultimo_diagnostico

medios_cliente             ← quién sigue a quién
  client_id · dominio_norm
  activo · prioritario · origen

reglas_filtro              ← lo que hoy es JavaScript
  id · client_id (null = todos)
  tipo    dominio | patron_titulo | patron_url | tld | idioma | antiguedad
  valor · peso · motivo · activa
  descartes_acumulados · reclamos_asociados     ← para auditarla

client_prompts             ← las instrucciones de la IA, versionadas
  client_id · version · contenido · vigente_desde

fetch_log                  ← un renglón por intento, aunque falle
  dominio_norm · ts · formato · transporte
  http_status · diagnostico · articulos · ms

candidatas_raw             ← todo lo que se trajo, SIN filtrar
  dominio_norm · url · titulo · fecha_pub · fecha_origen
  fecha_confiable · snippet · capturado_at · fetch_log_id

descartes                  ← por qué no salió cada una
  candidata_id · etapa · regla_id
  valor_que_matcheo · puntaje_final · explicacion
```

### Tres problemas que este modelo arregla de raíz

**1. Catálogo replicado.** Hoy hay 2.493 filas de medios para 1.776 dominios distintos: 445 dominios están cargados en más de un cliente. Un medio nuevo hay que darlo de alta 4 veces.

**2. Ad value roto.** Hoy `tiers.dominio` guarda **nombres de medio**, no dominios (`"03442 ahora"`, `"a todo motor"`). De 6.481 filas, **ninguna tiene un punto**. El cruce contra `medios` da **0 de 2.493**, y solo el 7,8% de las notas termina con ad value. Con una sola clave —el dominio normalizado— se arregla solo.

**3. Reglas como código.** Hoy las listas de dominios bloqueados viven en 3 nodos por workflow, **con contenido distinto entre clientes**. Un medio bloqueado a pedido del cliente en Booking sigue entrando por Mars y MSD.

---

---

## 8b. El ciclo de vida de un medio

**Esto es lo que conecta el dashboard con el pipeline, y hoy está cortado.**

### Lo que pasa hoy cuando el cliente carga un medio

Medido contra la base el 02/09/2026:

| Qué | Dato |
|---|---|
| Medios cargados por el cliente | 336 (220 activos), entre el 05/08 y el 31/08 |
| De esos, **sin una sola nota en 60 días** | **58 de 220 (26%)** — MSD 25, Booking 22, Mars 17, BMS 6 |
| `primer_uso` y `notas_total` escritos para `origen='cliente'` | **0 de 336** |
| Altas de medio registradas en `config_changelog` | **0 filas** (solo se audita `edicion`) |
| `medios_bloqueados` — bloqueo por cliente | **0 filas.** Tabla vacía |
| `medios_seguimiento` — pedidos del cliente | **0 filas.** Tabla vacía |
| Medios en `manual_review` sin feed, esperando a alguien | **377** |

Tres problemas concretos:

1. **El alta no dispara nada.** El medio queda esperando al próximo barrido. Si el método elegido no funciona, nadie se entera nunca.
2. **El dashboard le miente al cliente.** Como `notas_total` nunca se escribe para medios de origen cliente, los 162 que **sí** funcionan y los 58 que están muertos se ven exactamente iguales en pantalla: "0 notas, nunca usado".
3. **No hay vuelta atrás visible.** Bloquear un medio desde la plataforma no está implementado (tabla vacía) y el alta no queda auditada.

### El error de modelo que lo causa

`medios` tiene `client_id`, así que mezcla dos cosas que no son lo mismo:

- **Cómo se entra a un dominio** — propiedad del mundo. Infobae tiene RSS para todos o para ninguno.
- **Si un cliente lo sigue, en qué tier, si lo bloqueó** — decisión de ese cliente.

*Evidencia: de 1.683 dominios activos, **131 tienen método distinto según el cliente**. El mismo diario se scrapea por RSS para uno y por Jina para otro. No hay razón técnica.*

La consecuencia es que **el descubrimiento no se comparte**: arreglar la entrada a un medio para BMS deja a Mars rompiéndose contra el mismo dominio.

**La separación:**

```
medios_catalogo          (1 fila por dominio, sin client_id)
  dominio · transporte · estado
  ultimo_ok · fallas_seguidas

medios_fuentes           (1..N por dominio — ver más abajo)
  dominio · seccion · formato · url_feed
  ultimo_ok · notas_30d

medios_suscripcion       (1 fila por cliente × fuente)
  client_id · fuente_id · tier · prioritario
  bloqueado · motivo_bloqueo · vigente_desde
```

Un arreglo en el catálogo sirve para los cuatro. Una decisión del cliente no toca a nadie más.

Son **tres** tablas y no dos porque un dominio tiene varias puertas de entrada, una por sección. Eso se explica en el punto que sigue.

### Un medio no es una URL: el desglose por sección

**Este es probablemente el mayor agujero de cobertura del sistema, y no se ve en ninguna métrica.**

Cuando el cliente dice "seguí Clarín", entrar por `clarin.com/rss` trae la portada. La nota de salud que le interesa a MSD, o la de turismo que le interesa a Booking, vive en el feed de su sección y **nunca aparece en la portada**. No la descarta el filtro: no llega nunca.

**Lo que hay hoy** (medido 02/09/2026):

| Cliente | Fuentes de Infobae | Fuentes de Clarín |
|---|---|---|
| BMS | tendencias, economía, **salud** | portada, política, sociedad, buena-vida, economía |
| Booking | turismo, viajes | portada, lo-último, sociedad, último-momento, viajes, economía, info-general |
| Mars | mascotas | **solo portada** |
| MSD | **ninguna** | **solo portada** |

**MSD es el cliente de pharma y no tiene el feed de salud de Infobae.** BMS sí. El desglose se viene haciendo a mano, cliente por cliente, y quedó desparejo.

**Cuánto falta:** de **1.683 dominios activos, solo 21 están desglosados (1,2%)**. Los otros 1.662 entran por una sola puerta.

**Bugs encontrados en esas mismas filas:**

- `lanacion.com.ar` en Booking: `metodo='sitemap'` pero 3 de 4 URLs son RSS. Método mal etiquetado.
- `https://www.lanacion.com.ar/sociedad/` cargado como RSS — es una página HTML.
- `pagina12.com.ar` entra por Jina en BMS, Mars y MSD. Booking tiene el sitemap que funciona. El hallazgo no se compartió.
- Dos filas basura en MSD: `sin-dominio:clarin-com` y `sin-dominio:infobae`, en `manual_review`, de altas donde no se pudo parsear el dominio.

**El modelo:**

```
medios_catalogo          Un dominio. Cómo se entra en general.
  infobae.com

medios_fuentes           1..N por dominio. ESTO ES LO QUE FALTA.
  infobae.com · salud     · rss · .../category/salud/
  infobae.com · economia  · rss · .../category/economia/
  infobae.com · turismo   · rss · .../category/turismo/
  infobae.com · portada   · rss · .../rss/

medios_suscripcion       Qué fuentes le interesan a cada cliente.
  msd     → infobae/salud, infobae/portada
  booking → infobae/turismo, infobae/viajes
```

La ingesta recorre **fuentes**, no dominios. El dedup sigue siendo por URL de nota: si una nota de salud sale también en la portada, entra una sola vez.

**Cómo A0 descubre las secciones** — esto cambia lo escrito antes: A0 no busca *un* feed y corta, busca **el índice completo**.

1. **Página de feeds del medio.** Clarín la tiene en `/rss`. Los diarios sobre Arc (Infobae, La Nación) exponen `/arc/outboundfeeds/rss/category/<seccion>/`. Cuando existe, salen veinte secciones de una.
2. **Derivar del sitemap.** Las secciones están en el path de las URLs (`/salud/`, `/economia/`). Se listan las que aparecen y se prueba si cada una tiene feed propio.
3. **Probar patrones conocidos** por CMS: WordPress expone `/category/<slug>/feed/` para toda categoría.

**Y después alguien elige cuáles.** A0 propone cruzando las secciones que existen contra los intereses del cliente; **el equipo confirma desde la plataforma**. No se activan solas: cada sección de más es volumen de más, todos los días, para siempre.

- [ ] La pantalla del medio lista sus fuentes con un check por cliente
- [ ] Al agregar una fuente se muestra cuántas notas/día trae en promedio
- [ ] Una fuente en cero por 14 días se marca, igual que un medio

---

### El alta: sonda inmediata

Cuando el cliente pega una URL, **la sonda corre en el momento**, no de noche. Menos de 60 segundos, y el cliente ve el resultado antes de guardar.

Prueba en orden y corta en el primero que funciona:

| # | Qué prueba | Nota |
|---|---|---|
| 1 | RSS declarado en el HTML (`link rel="alternate"`) | El 46% de los medios entra acá |
| 2 | RSS adivinado: `/feed`, `/rss`, `/index.xml`, `/feed.xml` | |
| 3 | WordPress abierto: `/wp-json/wp/v2/posts` | **Hoy no se prueba nunca** y muchos lo tienen |
| 4 | Sitemap: `sitemap.xml`, `news-sitemap.xml` | Trae fecha confiable |
| 5 | Portada por HTML | Último recurso, sin fecha confiable |

Si cualquiera de esos rebota por IP (403, 401, timeout, Cloudflare), **se repite la escalera entera con Bright Data**. Un 403 no significa que el medio no tenga RSS: significa que no nos dejan verlo desde acá.

**Lo que ve el cliente:**

- **Anda** → tres titulares reales de ese medio, en pantalla. Entra al barrido de esa noche.
- **Anda a medias** → trae notas pero sin fecha confiable. Se le avisa el límite antes de guardar.
- **No se puede** → se dice el motivo y queda en la cola de A0, que sigue intentando todos los días.

**Nunca un alta muda.** Hoy el cliente aprieta guardar y no pasa nada visible; a los diez días pregunta por qué no llega nada de ese medio.

### Cambios de configuración: bloquear, cambiar tier, dar de baja

Todo cambio es un **evento con fecha de vigencia**, no un `update` destructivo.

| Acción | Efecto | Retroactivo |
|---|---|---|
| Bloquear un medio | Deja de entrar desde el clipping siguiente | **No.** Las notas de ayer quedan como están |
| Cambiar el tier | Nuevo ad value desde la fecha de vigencia | **No.** Los reportes viejos no se reescriben |
| Dar de baja | Sale de la suscripción de ese cliente | Sigue en el catálogo para los otros tres |
| Bloqueo global | Sale para todos | Solo lo hace el equipo, no el cliente |

- [ ] Toda alta, baja, bloqueo y cambio de tier escribe en `config_changelog` con usuario y fecha
- [ ] El cambio se aplica en el **próximo** clipping, nunca sobre uno ya enviado
- [ ] La pantalla del medio muestra su historial: quién lo agregó, quién lo bloqueó, cuándo

### La pantalla de salud de medios

Lo que hoy no existe y arregla el punto 2:

```
  Medio                    Tier   Últimas notas   Estado
  ─────────────────────────────────────────────────────────────
  Space Export              2      12 en 30 d     ✓ RSS
  Consenso Salud            1      41 en 30 d     ✓ sitemap
  Pulso Turístico           3       0 en 30 d     ⚠ sin fecha confiable
  Mundo Pharma              2       0 en 30 d     ✕ 403 hace 22 días
                                                    → A0 lo reintenta a diario
```

Cada medio muestra **cuántas notas trajo de verdad**, no un contador que nunca se escribió. Un medio en cero por 14 días dispara aviso al equipo antes de que pregunte el cliente.

- [ ] `notas_total` y `primer_uso` se escriben para **todos** los orígenes, no solo `auto`
- [ ] Los 58 medios que hoy están en cero se revisan uno por uno en la migración

## 9. Qué se construye y en qué orden

| # | Pieza | Dónde | Depende de |
|---|---|---|---|
| 0 | Cerrar esquema `test` abierto · arreglar `client_id` de v3 · apagar MSD duplicado | — | nada |
| 1 | `fetch_log` con los 4 estados y tabla de diagnóstico | Postgres | nada |
| 2 | Descubridor de estrategia (formato × transporte) | n8n · WF-1 | fetch_log |
| 3 | Los 3 subflujos de transporte | n8n · WF-2a/b/c | nada |
| 4 | Orquestador de ingesta por dominio | n8n · WF-2 | 2 + 3 |
| 5 | Normalización + compuertas | Postgres | `reglas_filtro` |
| 6 | **A1 · Completador** | n8n · WF-3 | 5 |
| 7 | **A2 · Juez** | n8n · WF-4 | 6 + `client_prompts` |
| 8 | **A3 · Auditor** | n8n · WF-5 | 7 |
| 9 | Armado, resumen y envío | n8n · WF-5 | 8 |
| 10 | Pantallas: descartes, reglas, salud | app | 5 + 8 |
| 11 | Salud y alertas | n8n · WF-6 | fetch_log |

### Quién hace qué

| # | Tarea | Quién | Estado |
|---|---|---|---|
| 1 | Cuenta de Cloudflare + login de wrangler | Fede | **Hecho** 02/09 |
| 2 | Escribir y deployar el Worker | Claude | **Hecho** |
| 3 | Deployar la Edge Function de AWS | Claude | **Hecho** (proyecto de prueba) |
| 4 | Benchmark de 38 feeds, las dos salidas | Claude | **Hecho** |
| 5 | **Medir los 359 medios que nunca entran, desde n8n** | Claude | Falta · necesita OK para crear un workflow de prueba |
| 6 | Crear `medios_catalogo` con la columna `transporte` | Claude | Falta |
| 7 | Decidir dónde vive la Edge Function en producción | Fede | Falta |
| 8 | Poner las dos keys y cerrar los proxies | Claude | **Hecho** · verificado 401 sin credencial |
| 8b | Crear las credenciales en n8n | Claude | **Hecho** · `PKPV9bTP9T8wZAHJ` y `7OwKt737r1MWbn7d` |
| 8c | Pasar la key de Cloudflare al gestor de contraseñas | Fede | Falta · hoy existe en una sola máquina |
| 9 | Regenerar la API key de Bright Data expuesta en `GSID` | Fede | Falta |
| 10 | Avisarle a Adrián antes de tocar los flujos | Fede | Falta · la v3 está en vuelo |
| 11 | Conectar el primer cliente (Booking) con golden antes y después | Claude | Falta |

**El paso 5 es el que decide si todo esto vale la pena.** Es un workflow aislado que no manda mails ni escribe en tablas del cliente, y de ahí sale el número: de los 359 medios que hoy nunca entran, cuántos recuperamos.

### El orden que recomiendo

**Primero el paso 1 y 2, corriendo sobre el sistema actual sin cambiarlo.** En una noche sabemos cuántos de los 1.776 dominios son alcanzables y por qué vía, que es la pregunta que hoy nadie puede contestar.

Con eso en la mano se construye la ingesta nueva, y **recién después los agentes**. Los agentes son la parte más fácil y la de menor riesgo: son tres llamadas con contrato claro. Lo difícil es tener buenos datos para darles.

### Dos condiciones que no se negocian

**Todo corre en paralelo antes de reemplazar.** Cada etapa nueva decide sobre los mismos datos del mismo día que la vieja, y las diferencias se revisan una por una. Es el mismo golden de SportClub y Cibel.

**Se arranca por Booking, no por BMS.** 210 medios contra 640, 18 keywords contra 106, corre en 5 minutos y es el que menos depende de la IA (20% de descartes determinísticos contra 7% en BMS). BMS es el más grande, el más particular y el más caro de equivocarse.

---

---

---

## 10. Operación: lo que hace que esto sobreviva a un martes cualquiera

Todo lo anterior describe el sistema andando bien. Esta sección es lo otro.

### 10.1 · Zonas horarias

**Es el hueco más peligroso del diseño y hay que resolverlo antes de escribir una línea.**

Los horarios de este documento están en **ART (UTC-3)**. Los triggers de n8n están en **UTC**: el de BMS dice 10:00 y sale 07:00 ART. Las dos numeraciones conviven en el mismo sistema y ya causaron confusión al medir.

Y las fechas de los feeds llegan en formatos distintos con offsets distintos:

```
<pubDate>Tue, 02 Sep 2026 14:32:00 -0300</pubDate>     RFC822 con offset
<pubDate>Tue, 02 Sep 2026 17:32:00 GMT</pubDate>       la MISMA nota, en UTC
<published>2026-09-02T17:32:00Z</published>            Atom
<lastmod>2026-09-02</lastmod>                          sitemap, SIN hora
```

**Las reglas:**

- [ ] Todo se **guarda** en UTC, con timestamp completo. Nunca `date` pelado
- [ ] Todo se **muestra y se decide** en `America/Argentina/Buenos_Aires`
- [ ] La ventana del clipping se calcula en ART y recién ahí se convierte a UTC para consultar
- [ ] Una fecha **sin hora** (sitemaps, `lastmod`) se marca `hora_desconocida = true` y **nunca se compara contra un corte horario** — solo contra el día
- [ ] Los cron de n8n se escriben en UTC con el equivalente ART **en el nombre del nodo**: `Trigger 10:00 UTC = 07:00 ART`

*Por qué importa: una nota publicada 23:30 ART del lunes llega como `02:30 UTC del martes`. Si el corte se compara mal, esa nota entra dos veces o ninguna.*

### 10.2 · Idempotencia

**Mandamiento 6 de Archytas: re-ejecutar lo mismo no duplica nada.** Hoy no se cumple — MSD corrió dos veces el mismo día y generó dos clippings.

| Operación | Clave de idempotencia |
|---|---|
| Guardar el clipping | `(client_id, fecha)` · upsert, no insert |
| Guardar una nota | `(clipping_id, url_canonica)` |
| Escribir en `fetch_log` | `(dominio, fuente_id, pasada, fecha)` |
| Registrar un descarte | `(client_id, fecha, url_canonica)` |
| Enviar el mail | **Bandera `enviado_at`.** Si ya tiene valor, no se manda de nuevo |

- [ ] Correr el mismo día dos veces produce **exactamente** el mismo clipping y **un solo** mail
- [ ] Ese caso es un test del golden, no una promesa

### 10.3 · Deduplicación: la regla, escrita

El dedup se nombra en todo el documento y nunca se define. Y está roto de dos maneras medidas:

| Bug medido | Dato |
|---|---|
| Historial anti-repetición contaminado con URLs de Google sin desenvolver | BMS 34,6% · Booking 38,2% · **MSD 54,9%** · Mars 0% |
| `norm_url` descarta el query string | Las 8 notas de Pulso Turístico normalizan a `pulsoturistico.com.ar/mas_informacion.asp` |

*MARS está en 0% porque ya tiene la función que desenvuelve. Bloquea 119 veces contra las 12 de BMS. El arreglo existe y no se replicó.*

**La URL canónica se construye así, en este orden:**

```
1. Desenvolver redirectores      news.google.com/... -> el dominio real
                                 (incluye batchexecute para el formato nuevo)
2. Forzar https, sacar www
3. Sacar parametros de tracking  utm_*, fbclid, gclid, _ga, ref, origin
4. CONSERVAR el resto del query  <- lo que hoy se rompe
                                 mas_informacion.asp?id=13902 NO es la portada
5. Sacar la barra final y el fragmento #
6. Minusculas en el host, NO en el path
```

- [ ] Una nota se considera repetida si su URL canónica ya está en el historial de **ese cliente** en los últimos 30 días
- [ ] El historial se limpia de las URLs de Google que quedaron sin desenvolver, **antes** de migrar
- [ ] Si dos URLs distintas tienen el mismo título y el mismo medio el mismo día, es la misma nota: gana la que tiene fecha confiable

### 10.4 · Cómo abre A1 una nota individual

La escalera de §4 está definida para **feeds**. Abrir el artículo es otro caso y también puede dar 403.

```
1. directo
2. proxy cloudflare       ?raw=1, aca queremos el HTML entero
3. proxy aws
4. jina                   ACA SI SIRVE: es HTML, no hay estructura que perder
5. brightdata
```

Jina, que para feeds está prohibido, **acá es la herramienta correcta**: la nota es una página y lo que buscamos es el texto.

- [ ] A1 usa el `transporte` que el catálogo ya tiene anotado para ese dominio, no vuelve a probar desde cero

### 10.5 · Presupuesto de A1

Corre 06:15 → 06:30. **Quince minutos para ~150 notas.**

| | |
|---|---|
| Notas a completar | ~150 (las incompletas, no las 400) |
| Concurrencia | 10, con tope de 2 por dominio |
| Timeout por nota | 8 s |
| Techo teórico | 150 × 8 s ÷ 10 = **2 minutos** |
| Margen | 13 minutos |

Entra holgado. **Pero el presupuesto es duro:** al minuto 12 corta, y lo que quedó incompleto pasa marcado. Nunca se estira sobre la hora de A2.

- [ ] Si A1 corta por presupuesto más de 3 días seguidos, es aviso a Slack: algo cambió

### 10.6 · Error Workflow y alertas

Requisito del checklist de producción de Archytas, hoy sin cumplir en los cuatro clippings.

- [ ] Cada workflow nuevo tiene **Error Workflow asignado** antes de activarse
- [ ] Las alertas van **consolidadas**: un resumen por corrida, no una por medio caído
- [ ] Ningún nodo nuevo lleva `continueOnFail` sin un `catch` que registre el motivo

### 10.7 · Migración desde el modelo actual

`medios` (con `client_id`) se convierte en tres tablas. **No se hace de una.**

| Paso | Qué | Reversible |
|---|---|---|
| 1 | Crear las 3 tablas nuevas, **vacías**, al lado de las viejas | Sí |
| 2 | Poblarlas leyendo `medios`. Las viejas siguen siendo la verdad | Sí |
| 3 | Comparar: mismo conjunto de dominios, mismos métodos, cero pérdidas | Sí |
| 4 | Resolver los 131 dominios con método distinto por cliente, **a mano** | Sí |
| 5 | Limpiar las 2 filas basura (`sin-dominio:clarin-com`, `sin-dominio:infobae`) | Sí |
| 6 | El flujo nuevo lee de las nuevas. El viejo sigue leyendo de las viejas | Sí |
| 7 | Borrar las viejas | **Recién cuando el nuevo lleve 30 días bien** |

- [ ] Los pasos 1 a 6 **no tocan nada de lo que usa el cliente hoy**

### 10.8 · Staging y rollback

**Staging es obligatorio acá** (checklist de Archytas): esto maneja datos reales de cliente y su falla le llega a Fedra.

| Fase | Con qué datos | Qué se prueba |
|---|---|---|
| Local | Los 38 feeds del benchmark | Que los proxies traen lo que dicen |
| Staging | Copia de un día real de Booking | Que decide **igual** que el flujo viejo |
| Producción | Un cliente, con el viejo prendido en paralelo | Que el mail sale y es el mismo |

**El golden:** antes de reemplazar nada, la v4 tiene que decidir **idénticamente** sobre los mismos datos que el flujo actual. Mismo día, mismas notas de entrada, mismo clipping de salida. Si difiere, se explica cada diferencia antes de avanzar. Es el patrón que ya usamos en SportClub y Cibel.

**Rollback:**

- [ ] El flujo viejo queda **desactivado, no borrado**, 30 días
- [ ] Volver = desactivar el nuevo y activar el viejo. Dos clicks, sin deploy
- [ ] Los datos que escribió el nuevo no rompen al viejo: tablas distintas
- [ ] Se define **antes de arrancar** qué dispara el rollback (ejemplo: dos días seguidos con volumen fuera de banda, o una queja del cliente)

### 10.9 · Modo testeo

**La v3 de MSD ya lo tiene resuelto y con el mismo enfoque.** Verificado el 02/09/2026:

```
Schedule Trigger 7:30AM ──► Set modo=prod ──┐
                                            ├──► GSID ──► ...
▶ Click acá para TEST   ──► Set modo=test ──┘

y en las tres salidas: IF Modo Prod (Success) / (Error) / (Sin Notas)
```

**Dos triggers distintos, no una bandera manual.** Es el patrón correcto y hay que copiarlo a los otros tres, que hoy no lo tienen: correr BMS, Booking o Mars a mano le manda el mail a Ketchum y quema las notas del día.

Lo que sigue es ese patrón llevado al detalle, con las tres salidas que faltan cubrir.

#### La compuerta

**Opción A — dos triggers, como ya hace la v3.** Explícito, se ve en el canvas, no depende de ninguna variable de runtime. Es la que recomiendo.

**Opción B — leer el modo de ejecución.** Sirve como guarda extra encima de A, no en lugar de A.

```js
// Verificado el 02/09/2026 contra archytasai.app.n8n.cloud:
// $execution.mode devuelve "production" en una corrida por cron o webhook.
// $execution expone: id, mode, resumeUrl, resumeFormUrl, customData.
const es_real = $execution.mode === 'production';
```

**Fail-safe a propósito.** La condición es `=== 'production'`, no `!== 'manual'`. Si el valor cambia de nombre, viene vacío, o alguien duplica el workflow, **cae en modo prueba**. Ante la duda, al cliente no le llega nada.

| Cómo arranca | `$execution.mode` | Modo |
|---|---|---|
| Cron de las 07:00 | `production` | **REAL** |
| Botón Execute en el editor | otro valor | **PRUEBA** |
| Webhook de producción | `production` | **REAL** |
| Cualquier caso raro | lo que sea | **PRUEBA** |

- [ ] Confirmar con un click en el editor qué valor exacto devuelve una corrida manual. El diseño no depende de eso — cualquier valor distinto de `production` cae en prueba — pero conviene tenerlo anotado

#### El pipeline no se entera del modo

Ingesta, compuertas, A1, A2, A3, armado: **todo corre idéntico en los dos modos.** Si el modo cambiara algo ahí, la prueba dejaría de probar lo que importa.

Lo único que ramifica son las **tres salidas del final**:

| | REAL | PRUEBA |
|---|---|---|
| Dónde guarda | esquema del cliente | **esquema de ensayo** |
| A quién le manda el mail | Ketchum | **al equipo, con banner arriba** |
| Historial anti-repetición | marca las URLs como enviadas | **no lo toca** |
| Métricas y promedios | cuenta | **no cuenta** |
| `fetch_log` y salud de medios | escribe | escribe (sirve igual) |

#### Por qué no se pierden notas

Este es el punto delicado. Hoy, correr el flujo a mano **te come las notas del día**: el historial marca esas URLs como enviadas, y cuando corre el cron real las descarta por repetidas. El cliente recibe un clipping incompleto por haber probado.

En modo prueba:

- [ ] Se guarda **todo**, en el esquema de ensayo. La corrida se puede revisar entera
- [ ] **No se escribe el historial anti-repetición.** Las URLs no quedan quemadas
- [ ] El cron real de esa mañana trae las mismas notas como si nunca se hubiera probado

#### La guarda dura

El nodo que manda el mail al cliente **tira excepción** si `es_real` es falso:

```js
if (!$json.es_real) {
  throw new Error('BLOQUEADO: intento de enviar al cliente en modo prueba');
}
```

No es un `if` en una rama que alguien puede olvidar al copiar el workflow: es una excepción. Si un bug de ruteo manda una corrida de prueba por el camino real, **el workflow frena**. Que no salga el mail es mucho menos grave que mandarle basura a Fedra.

Lo mismo en el nodo que escribe el historial anti-repetición.

#### Dónde viven los datos de prueba

**Esquema aparte, no una columna `modo`.** Con una columna, un solo `WHERE` olvidado en una vista del dashboard le muestra al cliente datos de ensayo. Con esquemas separados eso no puede pasar: es otra conexión.

PostgREST cambia de esquema por header, así que es un cambio de una línea en los nodos de Supabase:

```
REAL     Content-Profile: public
PRUEBA   Content-Profile: clipping_ensayo
```

**Con las mismas tablas y las mismas migraciones.** Si el esquema de prueba se desvía del real, deja de probar lo que importa.

> **No reusar el esquema `test` que ya existe.** Tiene 28 tablas, **cero RLS**, y `anon` con SELECT, INSERT, UPDATE, DELETE y TRUNCATE sobre todas. Contiene datos reales de cliente y una función `import_clipping` ejecutable de forma anónima. Cualquiera con la clave pública —que está en el front del dashboard— puede leerlo o vaciarlo. El esquema de ensayo de la v4 va **nuevo, con RLS desde el primer día**, y el viejo hay que cerrarlo aparte.

- [ ] Cerrar el esquema `test` actual (y `backup_20260827`, mismo problema, 27 tablas)
- [ ] Crear `clipping_ensayo` con RLS y las mismas migraciones que producción
- [ ] Una tarea semanal borra lo que tenga más de 30 días

#### Cómo se usa

1. Abrir el workflow en n8n y apretar **Execute Workflow**
2. Corre completo: ingesta, agentes, armado
3. El mail llega **al equipo**, con banner de "CORRIDA DE PRUEBA" arriba
4. El clipping queda en el esquema de ensayo para revisarlo con calma
5. El cron de la mañana siguiente corre como si nada hubiera pasado

- [ ] El banner del mail de prueba lleva fecha, hora y quién lo disparó

### 10.10 · Lo que este documento NO cubre

Honestidad sobre los límites:

- **Las gacetillas.** Existen `gacetillas` y `gacetilla_capturas` y no analicé cómo entran al circuito.
- **El editor web y la exportación.** Fuera de alcance.
- **Los clientes `-legado`.** Siguen recibiendo clipping diario y no está claro a quién le llega.

---

## 11. Tier y ad value: el dato que carga el cliente

**Es lo que más se ve del lado de Ketchum y hoy funciona en el 15,9% de las notas.**

### Cómo entra el dato

Fedra carga medios y valores **desde el dashboard, con su usuario**. La tabla `tiers` es la fuente. No se usa más una planilla.

`config_changelog` lo confirma: **82 cambios sobre `tiers` desde el 11/08**, el último el **02/09 a las 17:45**.

### Qué lee cada flujo — relevado en la instancia viva el 02/09/2026

**Los cuatro clientes ya leen el tier desde Supabase.** El flujo que le llega al cliente es la v3 en los cuatro casos.

| Cliente | Flujo que envía al cliente | Tier desde | Modo testeo |
|---|---|---|---|
| MSD | v3 | **Supabase** (`Get Config Clipping`) | Sí |
| Mars | v3 | **Supabase** | Sí |
| BMS | v3 | **Supabase** | Sí |
| Booking | v3 | **Supabase** | Sí |

Las v2/v1 que todavía corren leen el XLSX de Drive, pero **su mail va a `adrian@archytas.io`, no a Ketchum**. No afectan al cliente.

### Mover la fuente no alcanza, y está medido

| Cliente | Notas 21 días | Con ad value | % |
|---|---|---|---|
| Booking (v2, lee el XLSX) | 1.112 | 255 | **22,9%** |
| Mars (v2) | 1.883 | 376 | 20,0% |
| **MSD (v3, lee Supabase)** | 594 | 85 | **14,3%** |
| BMS (v2) | 964 | 112 | 11,6% |

**Los cuatro ya leen Supabase y ninguno pasa del 23%.** El problema no es de dónde sale el dato: es **cómo se cruzan los nombres**. Cambiar la fuente ya se hizo y no movió la aguja.

*Nota sobre un número anterior: el 7,8% que circuló estaba diluido por los clientes `-legado`, que tienen 0% y siguen generando notas. Sobre clientes vivos el piso real es 15,9%.*

### Por qué falla el cruce

No es corrupción de datos. Es variación humana al escribir un nombre:

| En las notas | En `tiers` | Causa |
|---|---|---|
| `pulso turístico` | `pulso turistico` | acento |
| `la voz del interior` | `voz del interior` | artículo inicial |
| `clarin.com` | `clarin` | dominio en vez de nombre |
| `infobae salud` | `infobae` | sección pegada al nombre |
| `dbiz today` | `dbiz` | sufijo |
| `diagnostics news` | `world diagnostics news` | prefijo |
| `el tribuno de jujuy` | `el tribuno` | **otro medio, no es variante** |
| `pharmabiz` · `turismo530` · `nuestroagro` | *(no están)* | falta de verdad |

**Tres familias, tres arreglos distintos.** Meterlas en la misma bolsa es lo que hace que no se resuelva.

*Síntoma de que ya se venía peleando con esto: dentro de `Build Tier Lookup` hay 4 valores clavados en el código, incluido el mismo medio con dos ortografías —`El Intransigente` y `El Instransigente`— porque el cruce fallaba.*

### Cobertura medida — 5.203 notas, 30 días, solo clientes vivos

| Estrategia | Notas con ad value | % |
|---|---|---|
| Hoy | 828 | **15,9%** |
| **Normalizando de los dos lados** | 1.893 | **36,4%** |

**Duplica la cobertura y no requiere que Fedra haga nada.**

### El diseño

**1. Normalización, la misma función de los dos lados.**

```
tier_norm(s):
  minusculas
  sin acentos          pulso turístico  -> pulso turistico
  sin .com/.com.ar     clarin.com       -> clarin
  sin articulo inicial la voz del...    -> voz del interior
  espacios colapsados
```

Vive **en la base**, no en un nodo. Una definición, cuatro clientes — misma regla que en La Fábrica con `roster_de_capitulo()`.

**2. Alias, para lo que la normalización no cubre.**

```
tier_alias
  infobae salud      -> infobae
  dbiz today         -> dbiz
  diagnostics news   -> world diagnostics news
```

Se administra desde el dashboard. **`el tribuno de jujuy` NO es alias de `el tribuno`**: son medios distintos con valores distintos. Por eso el alias es decisión humana y nunca un algoritmo de parecido — el error que ya costó caro en La Fábrica con los matches por una sola palabra.

**3. Capturar el dominio en el alta.** Como el alta pasa por nuestro dashboard, no hay que adivinar después.

- [ ] El campo de medio es un **selector sobre `medios_catalogo`**, no texto libre
- [ ] Se guarda `dominio` junto al nombre; el cruce pasa a ser por dominio, que no tiene ortografía
- [ ] Si el medio no está en el catálogo se permite texto libre, **marcado para revisar**

**4. Decirle qué falta, en vez de que se entere el cliente.**

- [ ] Pantalla "Medios sin valorizar", ordenada por volumen de 30 días
- [ ] Arriba lo que más duele: `pharmabiz` 66 notas, `turismo530` 56, `nuestroagro` 39
- [ ] Un botón por fila para asignar tier ahí mismo
- [ ] Aviso semanal a Slack con los 5 de mayor volumen sin valorizar

**5. Sacar los valores hardcodeados** de `Build Tier Lookup` en los cuatro flujos.

### Orden

| # | Qué | Cuánto recupera | Esfuerzo |
|---|---|---|---|
| 1 | **Normalizar de los dos lados** | 15,9% → **36,4%** | Chico |
| 2 | Pantalla de medios sin valorizar | Lo pone en manos de ella | Medio |
| 3 | Tabla de alias | Las variantes reales | Medio |
| 4 | Selector de dominio en el alta | Que no vuelva a pasar | Medio |

**El primero es de un día, duplica la cobertura, y no depende de la v4.** Se puede hacer sobre los flujos actuales.

---

## 12. Lo que está corriendo hoy en n8n

Relevado el 02/09/2026 contra `archytasai.app.n8n.cloud`. **23 workflows de Ketchum.**

### Cada cliente corre TRES pipelines completos, al mismo minuto

| Cliente | Hora | Workflows que dispararon hoy |
|---|---|---|
| Mars | 09:45 | v2 + v3 (A) + v3 (B) |
| BMS | 10:00 | v2 + v3 (A) + v3 (B) |
| Booking | 10:15 | v2 + v3 (A) + v3 (B) |
| MSD | 10:30 | v1 + v3 (A) + v3 (B) |

*Las horas están en UTC. Restar 3 para ART — ver §10.1.*

**El cliente recibe un solo mail.** En cada par de v3, una tiene el nodo de Gmail deshabilitado, y las v2/v1 mandan a `adrian@archytas.io`. Eso está bien resuelto.

**Pero se paga tres veces todo lo demás:** tres barridos de scraping contra los mismos medios, tres pasadas de OpenAI, tres escrituras a Supabase.

Esto explica cosas que veníamos midiendo sin entender:

- **Por qué los medios nos bloquean tanto.** Les pegamos tres veces cada mañana desde la misma IP, en el mismo minuto
- **Por qué la cuota de feed2json se agotaba** — el límite es 50/hora y salían 645 llamadas, no 215
- Parte del ruido en el historial anti-repetición

### Duplicados y sobrantes

| Workflow | Estado | Qué es |
|---|---|---|
| `Ketchum - Clipping Msd v3` × 2 IDs | ambos **activos** | duplicado |
| `Ketchum - Mars Clipping v3` × 2 IDs | ambos **activos** | duplicado |
| `Ketchum — BMS Clipping v3` × 2 IDs | ambos **activos** | duplicado |
| `Ketchum — Booking Clipping v3` × 2 IDs | ambos **activos** | duplicado |
| `Ketchum — BMS Clipping v3 DUPLICADO` | apagado | — |
| `Ketchum — BMS Clipping v2 TEST` / `TEST INTERNO` | apagados | — |
| `Ketchum - Pepsico Clipping` · `Pepsico Chile (DEV)` × 2 | apagados | otro cliente |

- [ ] **Hablarlo con Adrián antes de tocar nada.** Son flujos activos de producción
- [ ] Decidir qué v3 de cada par queda, y apagar la otra
- [ ] Decidir si las v2/v1 siguen corriendo para Adrián o se apagan
- [ ] Volver a medir el bloqueo de medios después de apagar los duplicados: **puede que buena parte del problema de scraping desaparezca solo**

> Esto no lo toqué. Es lo primero que le mostraría a Adrián, porque es barato de arreglar y cambia los números de todo lo demás.

## Anexo · Mediciones del 02/09/2026

Todo lo de abajo está medido, no estimado. Fuentes: Supabase `banlcbewinpjtudzdzhm`, ejecuciones de n8n, y una prueba en vivo de feed2json contra 38 feeds reales.

### A. feed2json.org — alcance

Prueba: 38 feeds (34 medios chicos del catálogo + Clarín, Infobae, La Nación, Página 12), directo vs feed2json, en paralelo.

| Qué | Resultado |
|---|---|
| Fidelidad cuando ambos andan | **Idéntica**: Clarín 10/10, Infobae 100/100, La Nación 93/93 |
| Items con `date_published` | **654 de 654 (100%)** |
| Latencia | mediana 1.183 ms · máx 3.540 ms |
| **Falla donde el directo funciona** | **5 de 38 (13%)** |

Los cinco que rompe: `trt.com.ar`, `el1digital.com.ar`, `ate.org.ar`, `bairessecreta.com`, `diariotag.com`. Cuatro devuelven 200 con cero items (parsean mal el feed); uno tira 500.

**Los límites, medidos hasta agotar la cuota:**

```
HTTP 429
Conversions limited to 50 per hour.
Please don't use this service for production.
```

| Qué | Dato |
|---|---|
| Límite | **50 conversiones por hora, por IP** |
| Cabecera `deprecation: true` | El dominio .org está deprecado |
| Sucesor en `toptal.com/developers/feed2json` | **Mismo límite de 50/hora** |
| Consumo | 1 request = 1 unidad. Repetir la misma URL no consume (cachea) |

**Conclusión: descartado como escalón general.** Necesitamos 1.776 feeds × 3 pasadas = 5.328 llamadas/día; el servicio da 1.200/día y pide explícitamente que no se use en producción. Ver §4 para el detalle del impacto en producción hoy.

### B. Google News — cuánto aporta

| Qué | Dato (30 días) |
|---|---|
| Notas entregadas con URL `news.google.com` | **1.482 de 7.498 = 19,8%** |
| Medios que llegan por Google | 433 |
| **Medios que llegan SOLO por Google** | **239** |

**No se toca.** Un quinto del clipping y 239 medios que ninguna otra vía trae. Va a la v4 como cuarto formato, al lado de rss, sitemap y html.

**Defecto a arreglar:** esas 1.482 notas se le mandan al cliente con el link de Google, no del medio. El decodificador (`batchexecute`) existe pero tiene `MAX_RESOLVE = 12` por corrida. El cliente hace click y cae en Google.

- [ ] En la v4 la resolución de URL de Google News corre en la ingesta nocturna, sin tope

### C. Tiempos reales de ejecución

| Cliente | Arranca | Dura | Termina | Margen al siguiente |
|---|---|---|---|---|
| Mars | 06:45 | 2m 55s | 06:47 | 12 min |
| BMS | 07:00 | **10m 29s** | 07:10 | 4,5 min |
| Booking | 07:15 | 5m 35s | 07:20 | 9,5 min |
| MSD v3 | 07:30 | **11m 46s** | 07:41 | — |

**BMS es el riesgo actual.** 10m 29s dentro de una ventana de 15 minutos: si crece 45% choca con Booking. Y el desglose por secciones (§8b) lo va a hacer crecer.

Esto valida la arquitectura de la v4 por otra vía: al sacar la ingesta de la ventana de la mañana, el armado por cliente baja a ~4 minutos y el margen deja de depender de cuántos medios tenga cada uno.

### D. El embudo: dónde se pierde el contenido

Promedio de 21 días, tabla `run_stats`:

| Cliente | Medios intentados | Sin resultado | Fetched | Post dedup | Post IA | Enviadas |
|---|---|---|---|---|---|---|
| BMS | 598 | 159 (27%) | 2.808 | 588 | 52 | 46 |
| Booking | 206 | 58 (28%) | 2.461 | 347 | 57 | 57 |
| Mars | 423 | 190 (45%) | 1.330 | 382 | 90 | 90 |
| MSD | 516 | **313 (61%)** | 726 | 355 | 29 | 29 |

Dos hallazgos:

1. **MSD tiene el 61% de sus medios devolviendo nada**, y es el que menos notas manda. No es que MSD tenga poca prensa: no llegamos.
2. **Booking solo intenta 206 medios** de los 1.683 del catálogo. Los otros 1.477 ni se tocan.

### E. Costo y estabilidad de OpenAI

| Qué | Dato (93 corridas, 21 días) |
|---|---|
| `ia_chunks_error` promedio | **0,00** |
| Costo por corrida | USD 0,033 a 0,061 |
| **Costo mensual, los 4 clientes** | **≈ USD 6** |

El cortafuegos de 429 de §7 es prevención, no un incendio actual. Y el costo de IA es despreciable: **no hay que optimizar por ahí**. Si hace falta más IA para mejorar la calidad, se paga sin discusión.

### F. Que nada explote: el estado real

Revisadas las ejecuciones con estado `error` de los últimos días: hay varias, **todas de otros clientes**. Los cuatro clippings figuran siempre en `success`.

Con 313 medios de MSD devolviendo vacío todos los días, n8n reporta éxito.

**Es la confirmación empírica del problema de fondo:** el sistema no distingue entre un día tranquilo y un día roto. Por eso §7 invierte el principio.

## Anexo · Lo que se conserva de la v3 de Adrián

La versión 3 de MSD ya resolvió bien la capa de datos. **No hay que rehacerlo:**

- ✅ Configuración migrada a Supabase con una sola llamada a `get_config_clipping`
- ✅ `schema_target` como cabecera de PostgREST para aislar test de producción
- ✅ Modo test completo: destinatario, esquema y silencio de Slack, con trigger manual propio
- ✅ Escritura directa del clipping vía `import_clipping`, sin el webhook al workflow viejo
- ✅ Telemetría real con `log_run_stats`
- ✅ Tiers vivos y `ad_value` persistido en la nota

**Lo que hay que reemplazar es la capa de fetch.** Bright Data entró ahí como parche al final del pipeline viejo, no como estrategia. Por eso sigue tardando 12 minutos para traer 33 notas.

---

*Documento basado en: 570 correcciones del equipo de Ketchum (14/08 al 02/09/2026) · mails de Fedra del 28/07, 14/08 y 21/08 · telemetría de `run_stats` del 26/08 al 02/09 · código de los 4 workflows y de la v3 · esquema completo de Supabase. Cada número citado fue verificado contra la base.*
