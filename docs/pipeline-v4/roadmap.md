# Roadmap de construcción · Pipeline v4 de Clipping · Ketchum

**Base:** [`pipeline-v4.md`](./pipeline-v4.md) (03/09/2026) · **601 reportes** de Fedra en Supabase `banlcbewinpjtudzdzhm.public.reportes` (14/08 → 03/09/2026) · instancia destino: **ketchum-n8n**
**Fecha:** 03/09/2026 · **Estado:** propuesta

---

## 1. Decisiones tomadas (03/09/2026)

1. **Alcance: todo entrelazado.** Las mismas fases cubren el pipeline de n8n, el modelo de datos en Supabase y las cuatro pantallas nuevas del dashboard (`ketchum-mailchimp`). Las secciones §6 y §11 del doc no sirven sin UI.
2. **v4 hace *leapfrog*.** La v3 sigue corriendo en la cuenta n8n de Archytas compartida hasta que la v4 la reemplace, cliente por cliente. **No se termina de migrar la v3 a `ketchum-n8n`**; la v4 se construye desde cero ahí y el golden compara contra la salida real de la v3-en-Archytas.
3. **Granularidad (recomendación):** híbrido. Lógica pura (sin I/O) en funciones de Postgres — una definición para los cuatro clientes, testeable con el golden. I/O y orquestación en subworkflows de n8n con contrato de entrada/salida fijo y traza de ejecución propia. Inventario en §4.
4. **Trackeo (recomendación):** ledger en Supabase — `pipeline_runs` + `stage_events` + RPC `log_stage()`, un Error Workflow global, `descartes` para nota-por-nota. Las filas de agente llevan tokens/costo/modelo. Sin tracing externo por ahora (el costo de IA es ≈ USD 6/mes, no es un incendio).
5. **Rama aislada.** Todo el trabajo de v4 (docs, migraciones, código del dashboard, JSON de workflows exportados) vive en `feat/pipeline-v4`. No se mergea a `main` salvo por fase cerrada + revisión de un 2º. Ver §3.

---

## 2. La evidencia: 601 reportes de Fedra

~90 resueltos, ~510 abiertos. 3 semanas. **BMS 329 · MARS 95 · MSD 95 · Booking 82.**

| Bucket | Reportes (abiertos) | Causa raíz | Pieza v4 | Fase |
|---|---|---|---|---|
| **No relevante** — "no va", "habla de agro", "no menciona competencia" | ~191 (170) | La IA filtra sin criterio estable; reglas en JavaScript repartidas en 3 nodos × 4 workflows, con contenido distinto entre clientes | §5 compuerta "puntúa" + A2 juez con `client_prompts` versionado | 4, 5 |
| **No entró** — `falta_nota` con URL | ~168 (129) | Medio bloqueado por IP (fetch directo falla 94%); dominio no desglosado por sección; descartado por no tener fecha confiable | §4 escalera de transporte (proxies) + §8b `medios_fuentes` + §5 no descartar sin fecha + A0 | 2, 3, 4 |
| **Sección incorrecta** | ~59 (52) | El clasificador se queda con la primera keyword que matchea (término administrativo, marca de competencia) | A2 juez decide sección + tabla de secciones + `client_prompts` | 5, 7 |
| **Formato** — sin descripción / título con el link / sin fecha / 404 | ~73 (68) | Sin paso que complete lo que falta; sin auditor del clipping armado | A1 completador + A3 auditor (chequeos duros: saca la nota, no frena el envío) | 5, 6 |
| **Nota extranjera** — ".cl", "España", "Puerto Rico" | ~39 (32) | URL de Google News sin decodificar → el geo-check mira `news.google.com`, no el dominio real; blocklist distinta por cliente | §5 compuerta "no entra nunca" sobre la URL canónica + `reglas_filtro` globales | 1, 4 |
| **Vieja / repetida** — "ya la enviamos", "se repite hace meses" | ~34 (26) | Dos normalizadores de URL con reglas distintas en el mismo proceso; se borra todo el query string; historial contaminado con URLs de Google; el mail no dedupea | §10.3 URL canónica única + §5 fecha confiable + limpieza del histórico antes de migrar | 0, 1, 4 |
| **Exclusiva que no entró** | ~13 (11) | Sin compuerta que proteja lo que el cliente eligió. La IA descartó 262 notas de dos medios de nicho que cargó Fedra, en 7 días | §5 compuerta "entra sí o sí" + A3 repesca + aviso suelto de exclusivas | 4, 5, 6 |
| **Otro** — volumen ("salieron 50, el 90% no va"), bugs de dashboard | ~18 (18) | Funnel de IA demasiado ancho; bugs puntuales: el alcance no aparece en la precarga, el resumen toma solo la primera nota | §1 la IA ve 20× menos + §7 volumen esperado + fixes de dashboard | 4, 7 |

> Los números salen de una clasificación por palabra clave sobre `descripcion`; la forma importa más que el decimal.

---

## 3. Aislamiento: no tocar lo que usa Fedra

Los frentes por donde se puede contaminar producción, y la guarda de cada uno.

| Frente | Riesgo | Guarda |
|---|---|---|
| **Dashboard** (`ketchum-mailchimp` en Vercel) | Un cambio de ruta / componente / query rompe la herramienta que Fedra usa todos los días | Todo el trabajo de v4 en la rama `feat/pipeline-v4`. Nada se mergea a `main` hasta que su fase esté cerrada y revisada por un 2º. Las pantallas de Fase 7 se **agregan**, no reemplazan. Review por deploy preview de Vercel, nunca push directo. |
| **Supabase `public`** | Un `ALTER` / `DROP` o una función reescrita rompe la v3 que le llega al cliente | Todo lo nuevo se crea **al lado**: tablas nuevas, funciones con nombre nuevo. `public` sigue siendo la verdad. `import_clipping` / `get_config_clipping` no se tocan hasta el cutover. Migraciones reversibles (§10.7 del doc, pasos 1–6). |
| **Schema de pruebas** | Reusar el `test` actual (0 RLS, `anon` con TRUNCATE, `import_clipping` anónimo) | `clipping_ensayo` nuevo, RLS desde el día 1, mismas migraciones que `public`. La Fase 0 **cierra** `test` y `backup_20260827`. |
| **n8n** | Un workflow nuevo activo pisa la corrida real | v4 entera en `ketchum-n8n`, con los v3 importados en `active:false`. La prod real sigue en la cuenta Archytas compartida, intacta. Ningún workflow nuevo pasa a `active:true` sin golden + staging. |
| **El mail a Ketchum** | Una corrida de prueba le manda basura a Fedra, o le quema las notas del día | `sub/send-email` tira excepción si `!es_real`. En modo ensayo: mail al equipo con banner, y **el histórico anti-repetición NO se escribe** → el cron real trae las mismas notas como si nunca se hubiera probado (arregla el bug del §10.9). |
| **Métricas de Fedra** | Las pruebas inflan promedios y umbrales aprendidos | Modo ensayo no cuenta en `run_stats` ni en los umbrales. |
| **Cuenta Archytas compartida** | La higiene de Fase 0 toca flujos en vuelo | Los únicos cambios que la tocan (apagar corridas triples, regenerar key de Bright Data) se hablan con Adrián primero y NO son parte de construir v4 — son higiene previa. |

**La regla:** hasta la Fase 8, un desarrollador de v4 puede romper todo lo que quiera sin que Fedra se entere. El primer momento en que v4 toca algo que el cliente ve es el cutover de **un** cliente, y ese cutover es reversible en dos clicks (§10.8 del doc).

---

## 4. Recomendación: granularidad

**Regla:** un subworkflow por cada responsabilidad que quieras ver fallar por separado en la lista de ejecuciones. Lógica pura (sin I/O) va a función SQL — una sola definición para los cuatro clientes, y se testea con el golden.

### Subworkflows de n8n — contrato fijo, traza propia, reutilizables entre los 4 clientes

| Subworkflow | Entrada | Salida | Lo usa |
|---|---|---|---|
| `sub/fetch-source` | `{fuente_id, url, formato, transporte}` | `{items[], diagnostico, http_status, con_fecha, ms}` | ingesta, pasada caliente, descubridor, medición |
| `sub/open-article` | `{url, transporte}` | `{html, texto, og, jsonld, status}` | A1 |
| `sub/llm-call` | `{prompt, schema, modelo, max_tokens, run_id, stage}` | `{data, tokens, costo, ms}` + escribe `stage_events` | A1, A2, A3 |
| `sub/slack-notify` | `{canal, nivel, titulo, cuerpo, acciones[]}` | `{ok}` | todos |
| `sub/send-email` | `{clipping_id, destinatarios, es_real}` | `{enviado_at}` — `throw` si `!es_real` | armado por cliente |
| `sub/agent-A1` (completador) | lote de candidatas incompletas | candidatas completas + `completado[]` | armado por cliente |
| `sub/agent-A2` (juez) | lote de 12 + `client_prompt` + secciones | veredicto por nota | armado por cliente |
| `sub/agent-A3` (auditor) | clipping armado entero | `{notas_a_quitar[], notas_a_repescar[], hallazgos[]}` | armado por cliente |

### Orquestadores top-level — uno cada uno, no reutilizables

| Workflow | Trigger | Qué hace |
|---|---|---|
| `wf/descubridor` (A0) | 09:30 diario | formato × transporte sobre 30 dominios/día → `medios_estrategia` |
| `wf/ingesta` | 00:00 / 03:00 / 05:30 | recorre `medios_fuentes`, llama `sub/fetch-source` → `candidatas_raw` |
| `wf/armado-cliente` | 1 por cliente, 10 min antes del corte | caliente → compuertas → A1 → A2 → A3 → armado → nivel → guardar → mail |
| `wf/salud` (WF-6) | post-envío | cobertura, medios mudos, volumen esperado por día de la semana |
| `wf/error-handler` | Error Workflow de todos | consolida a Slack + escribe el fallo en `stage_events` |

### Funciones de Postgres — una definición, 4 clientes

`url_canonica()` · `resolver_fecha()` (cascada del §6) · `es_repetida()` · `normalizar_y_compuertas()` · `tier_norm()` + `tier_alias` · `armar_clipping()` · `decidir_nivel()` (§7) · `log_stage()` (RPC del ledger)

---

## 5. Recomendación: trackeo

Hoy "perder datos" y "un día tranquilo" se ven exactamente igual: casi todos los nodos tienen `continueOnFail` y devuelven lista vacía. El ledger invierte eso.

```
pipeline_runs                     una fila por corrida × cliente × modo
  id · client_id · fecha · modo(prod|ensayo) · trigger
  arranco_at · termino_at · nivel_salida · estado

stage_events                      una fila por etapa, al entrar y al salir
  run_id · stage · fase(in|out) · ts
  n_in · n_out · ms · status(ok|degradado|error) · error_txt
  tokens · costo_usd · modelo        (solo etapas de agente)

descartes                         una fila por nota que no entró (doc §6, §8)
  candidata_id · run_id · etapa · regla_id
  valor_que_matcheo · puntaje_final · explicacion · recuperable
```

- Cada subworkflow llama `log_stage()` al entrar y al salir — es una llamada HTTP a una RPC, no un Execute Workflow, así que no infla la lista de ejecuciones.
- `wf/error-handler` es el Error Workflow de todos los workflows nuevos y consolida: un mensaje por corrida, no uno por medio caído (§10.6).
- Las cuatro pantallas del dashboard leen de estas tablas. "¿Por qué no entró esta nota?" es un `select` sobre `descartes`.
- Ningún nodo nuevo lleva `continueOnFail` sin un `catch` que escriba el motivo en `stage_events` (§7).

---

## 6. El roadmap

Fases en orden de dependencia. Cada una es reversible y no toca lo que el cliente usa hoy hasta la Fase 8.

### Fase 0 · Higiene y base — sin arquitectura nueva

Siete cambios sobre lo que corre hoy. Ninguno construye v4 — limpian la deuda que, si no, ensucia todo lo que viene, sobre todo la medición del gate de Fase 2.

**Tocan la cuenta n8n de Archytas → con Adrián primero**

| # | Cambio | Por qué ahora | Riesgo |
|---|---|---|---|
| 0.1 | **Relevar y apagar las corridas triples.** Cada cliente dispara hoy 3 pipelines completos al mismo minuto en esa cuenta: v1/v2 vieja (→ `adrian@archytas.io`) + dos v3 (una con Gmail apagado). Confirmado: MSD tiene la vieja (`6NzarSOtBiuvbA7u`, 96 nodos) activa al lado de la v3 (`19NPw3POuwTKdUsK`). Falta relevar BMS/Mars/Booking. | Le pegamos 3× a cada medio desde la misma IP en el mismo minuto → parte de "nos bloquean" puede ser autoinfligido. Medir cobertura (Fase 2) con la carga 3× puesta da un número falso. | Workflows activos de producción. |
| 0.2 | **Re-medir el bloqueo de medios** tras apagar los duplicados (`run_stats`: `medios_intentados/ok/sin_resultado`, unos días). | Ajusta el alcance de la Fase 2: si "sin resultado" baja fuerte, el problema de transporte es más chico que los 359 del doc. | Solo lectura. |
| 0.3 | **Regenerar la API key de Bright Data.** Los 4 v3 tienen 3 keys hardcodeadas en texto plano en el nodo `GSID` (Jina, OpenAI, Bright Data), el mismo valor en los 4. Regenerar la de Bright Data (la que cuesta plata) y actualizar los 4 `GSID` en la misma sesión. Mover las 3 a Credentials es refactor de v4, no Fase 0. | Key expuesta = alguien puede quemar la cuota (USD 1,50/1.000). | Los 4 flujos fallan en el intervalo entre regenerar y actualizar. |

**Solo Supabase → lo hace el equipo**

| # | Cambio | Por qué ahora | Riesgo |
|---|---|---|---|
| 0.4 | **Quick win de ad value:** función `tier_norm()` (minúsculas, sin acentos, sin `.com`, sin artículo inicial) aplicada **de los dos lados** del cruce nombre↔tier. Medido: 15,9% → 36,4% de cobertura, sin que Fedra haga nada. Un día (§11 paso 1). | Es plata que Fedra deja sobre la mesa todos los días. No depende de v4. | Único item de Fase 0 que toca una función que la v3 usa (`get_config_clipping`). Es aditivo, pero lleva revisión de un 2º + corrida de TEST. Si se quiere aislamiento estricto, se mueve a la ola de v4. |
| 0.5 | **Limpiar el histórico anti-repetición.** `notas_historico_url` tiene URLs de Google sin desenvolver: BMS 34,6% · Booking 38,2% · MSD 54,9% (MARS 0%, ya tiene la función). Script SQL que pasa el desenvolvedor una vez y colapsa duplicados. Backup de la tabla antes. | Una URL de Google cruda nunca vuelve a matchear la real → la nota se re-envía para siempre. La Fase 4 (dedup con URL canónica) hereda este histórico. | Bajo — tabla de soporte, no la ve el cliente. |
| 0.6 | **Cerrar el schema `test` y `backup_20260827`.** 28 y 27 tablas, **cero RLS**, `anon` (clave pública, está en el front del dashboard) con SELECT/INSERT/UPDATE/DELETE/**TRUNCATE**, `import_clipping` ejecutable anónimo, datos reales de cliente. Antes: confirmar que ningún v3 apunta a `schema_target=test` (el modo TEST de la v3 lo usa). Opciones: revocar grants a `anon` / sacar de "Exposed schemas" / dropear. La v4 no lo reusa. | Bug de seguridad real: cualquiera con la clave pública puede leerlo o vaciarlo. | Romper el modo TEST de la v3 si no se verifica primero. |
| 0.7 | **Arreglar `client_id` de la v3 + apagar el MSD duplicado.** Cada cliente tiene un par en `public.clients` (vivo + "(histórico)" con datos v2). Verificar que ningún nodo v3 escriba con el histórico. Apagar la v3 de MSD que sobra (2 IDs, uno solo va). Se releva el detalle exacto. | El doc lo marca como paso 0. Datos que aterrizan en el client_id equivocado no los ve nadie. | Bajo, previa verificación. |

**Salida:** números limpios para medir la Fase 2, deuda de seguridad cerrada, +20 pts de ad value ya en producción. Cierra parte de "extranjera" y "vieja/repetida" — sin escribir una línea de v4.

### Fase 1 · Modelo de datos v4 en Supabase — nuevo, al lado, vacío

- `medios_catalogo` / `medios_fuentes` / `medios_suscripcion` (§8b). Poblar leyendo `medios`; comparar dominio por dominio, cero pérdidas; resolver a mano los 131 dominios con método distinto por cliente; limpiar las 2 filas basura (`sin-dominio:clarin-com`, `sin-dominio:infobae`).
- `reglas_filtro` · `client_prompts` (versionado) · `fetch_log` (4 estados + diagnóstico) · `candidatas_raw` · `descartes`.
- Ledger: `pipeline_runs` · `stage_events` · RPC `log_stage()`.
- `clipping_ensayo`: schema nuevo, RLS desde el día 1, mismas migraciones que `public` (§10.9).
- Funciones puras en SQL: `url_canonica()`, `resolver_fecha()`, `es_repetida()`, `tier_norm()` + `tier_alias`.

**Salida:** todo el modelo listo y vacío. Las tablas viejas siguen siendo la verdad. Reversible (pasos 1–6 del §10.7).

### Fase 2 · Transporte y cobertura — gate de decisión (§9 paso 5)

- `sub/fetch-source` con contrato fijo y switch interno: directo → cloudflare → aws → jina → brightdata. Escribe `fetch_log`. Los 2 proxies ya están deployados, con credenciales en n8n (`PKPV9bTP9T8wZAHJ`, `7OwKt737r1MWbn7d`).
- `wf/descubridor` (A0): formato × transporte, escribe `medios_estrategia`.
- **Workflow aislado de medición:** corre los 1.776 dominios una noche. No manda mails, no escribe tablas de cliente. Sale el número: de los 359 medios que hoy nunca se visitan, cuántos recuperamos.

**Gate:** si la medición recupera pocos medios, se replantea el alcance de v4 antes de seguir. Necesita OK explícito para crear el workflow de prueba.

### Fase 3 · Ingesta compartida (`wf/ingesta`)

- Orquestador por `medios_fuentes`, 3 pasadas (00:00 / 03:00 / 05:30), concurrencia 20 / 2 por dominio, lotes de 25 (§3).
- Pasada 2 = solo los ~360 que fallaron + los `publica_de_madrugada`, bajando un escalón de transporte.
- Cierre de cobertura al terminar la pasada 3 + alerta Slack si < 90% a las 5:45.
- Escribe `candidatas_raw` crudo, sin filtrar.
- Pasada caliente por cliente (10 min antes del corte) + carril expreso: mismas compuertas y mismo A2, solo RSS/sitemap directo, presupuesto duro de 10 min (§3).

**Salida:** el pool `candidatas_raw` se llena cada noche en `clipping_ensayo`, en paralelo, sin reemplazar nada.

### Fase 4 · Normalización + compuertas (§6, SQL)

- Función `normalizar_y_compuertas()`: normalizar (desenvolver Google, conservar el id del artículo, resolver dominio) → resolver fecha (cascada, nunca inventar, nunca poner la de hoy) → deduplicar (una sola regla) → 3 compuertas ("entra sí o sí" / "no entra nunca" / "puntúa").
- Poblar `reglas_filtro` desde el JavaScript actual de los 4 workflows, una sola vez. Vale para los 4.
- Cada descarte escribe `descartes` con `regla_id` + `valor_que_matcheo`.

**Cierra:** el grueso de "extranjera", "vieja/repetida", la mitad de "no relevante", y — con la compuerta "entra sí o sí" — "exclusiva que no entró".

### Fase 5 · Los agentes

- `sub/llm-call` compartido: OpenAI + 1 retry + backoff 429 + tope de tokens por cliente/día + escribe tokens/costo en `stage_events` (§7).
- `sub/agent-A1` (completador): detecta qué falta y lo va a buscar con `sub/open-article`. Limpia `<a>` de las descripciones (bug reportado en MSD), corta el sufijo del medio del título, reemplaza descripción de otra nota (bug reportado).
- `sub/agent-A2` (juez): lee `client_prompts` + tabla de secciones, lotes de 12, escala a modelo grande si confianza < 0,80 o medio prioritario. **No puede descartar** notas de medio prioritario o con marca del cliente — solo decide la sección (regla de Fedra del 28/07).
- `sub/agent-A3` (auditor): ve el clipping entero. Chequeos duros (saca la nota culpable, no frena el envío) + blandos (avisan) + repesca de descartes con score 0,4–0,6.

**Cierra:** "no relevante" (juez estable), "sección incorrecta", "formato" (A1 completa, A3 audita), el ruido de volumen de MARS (§1).

### Fase 6 · Armado, salida y degradación (§7)

- `armar_clipping()` en SQL: orden de secciones, ad value desde `medios_catalogo`, resumen del día. Determinístico (necesario para el golden).
- `decidir_nivel()`: nodo determinístico a las 07:20, elige nivel 0–3 según qué etapas anduvieron. No puede devolver "no salgo".
- Guardado en la plataforma **primero**, `listo_para_enviar = true`, después el mail leyendo lo guardado.
- `sub/send-email` con guarda dura: `throw` si `!es_real` (§10.9). Misma guarda en el nodo que escribe el histórico anti-repetición.
- `sub/slack-notify` con el formato del §7 (nivel, notas quitadas, tiempo para revisar, botones).
- Idempotencia: upsert por `(client_id, fecha)`, bandera `enviado_at` (§10.2).
- `wf/salud` (WF-6): cobertura, medios mudos (N × ritmo de publicación medido), volumen esperado **por día de la semana** (BMS domingo −44%; un umbral global dispararía alarma todos los domingos, §7).

**Cierra:** "formato: página 404" (A3 muestrea links), el silencio de los días rotos (MSD tuvo un día con 0 notas y se supo semanas después).

### Fase 7 · Dashboard (`ketchum-mailchimp`)

Puede arrancar en paralelo apenas existan `descartes` + `reglas_filtro` (fin de Fase 1); se completa contra Fases 5 y 6.

- **"Notas que no entraron"** sobre la pestaña Actividad (§6): medio + motivo + regla + valor que matcheó + botón **Subir**. Al subir: la regla suma un error; 3 errores → marcada para revisar.
- **"Reglas de filtrado"** (§6): descartó / errores / estado, por cliente y global. `+ Nueva regla`, `Ver propuestas`.
- **"Salud de medios"** (§8b): notas reales de 30 días (no un contador que nunca se escribió), estado, transporte. Un medio en cero 14 días dispara aviso.
- **"Medios sin valorizar"** (§11): ordenada por volumen de 30 días (`pharmabiz` 66, `turismo530` 56, `nuestroagro` 39), asignar tier inline, aviso semanal a Slack.
- Sonda de alta inmediata (§8b): el cliente pega una URL → 3 titulares reales en < 60 s, antes de guardar. Nunca un alta muda.
- `config_changelog` para toda alta/baja/bloqueo/cambio de tier, con fecha de vigencia; el cambio se aplica en el **próximo** clipping, nunca sobre uno enviado.
- Fixes puntuales de reportes `otro`: el alcance no aparece en la precarga de exclusivas; el resumen de IA toma solo la primera nota.

**Cierra:** las 570+ correcciones que hoy no alimentan nada. El ticket original de la pestaña de reportes pedía "que el equipo técnico lo revise, lo corrija y ajuste la configuración base para que no se repita" — la segunda mitad nunca se construyó.

### Fase 8 · Golden + primer cutover

- **Golden:** la v4 decide idéntico sobre los mismos datos que la v3-en-Archytas, mismo día, mismas notas de entrada, mismo clipping de salida. Cada diferencia se explica antes de avanzar. Mismo patrón que SportClub y Cibel.
- Staging obligatorio (§10.8): copia de un día real del cliente piloto.
- Cutover: `wf/armado-cliente` del piloto activo en `ketchum-n8n`; su v3 en la cuenta Archytas se **desactiva, no se borra**, 30 días.
- Rollback definido antes de arrancar: 2 días seguidos con volumen fuera de banda, o una queja del cliente = desactivar el nuevo, activar el viejo. Dos clicks.

#### Orden de pilotos: Booking piloto, BMS segundo (decidido 03/09)

**Piloto = Booking.** 210 medios contra 640, 18 keywords contra 106, corre en 5 min, 20% de descartes determinísticos contra 7% en BMS → el golden es más rápido y el error más barato. Si la arquitectura tiene una falla, se ve en el contexto más limpio; en BMS (99 nodos, POST-AI propio, 10m29s) es casi imposible separar "bug de v4" de "rareza de v3".

**BMS segundo, no cuarto.** Es donde más duele (329 reportes, la mayoría `falta_nota`, 29 notas enviadas/día). Pero el grueso de ese dolor —los ~168 `falta_nota` = medios bloqueados por IP + sin desglose por sección— lo arreglan las **Fases 2–4, que son compartidas** y corren en `clipping_ensayo` para los 4 clientes a la vez. Los números de BMS mejoran en ensayo **desde la Fase 3, sin haber cortado nada**. Si al terminar la Fase 6 esos números están bien y el golden de Booking sale limpio, los dos cutovers pueden ir casi juntos.

### Fase 9 · Replicar al resto

- Mismo pipeline. Cambia `client_id`, `client_prompts`, suscripciones de `medios_fuentes` y horario. "Un cliente nuevo es una fila en una tabla y un horario."
- Orden sugerido: **BMS** (donde más duele) → Mars → MSD. Se confirma con los números de ensayo de la Fase 6.
- Cada cutover apaga la v3-en-Archytas de ese cliente. A los 30 días sin incidentes, borrar las viejas y el modelo `medios` con `client_id`.

---

## 7. Camino crítico

`Fase 0` → `Fase 1` → **`Fase 2` (gate)** → `Fase 3` → `Fase 4` → `Fase 5` → `Fase 6` → `Fase 8` (piloto) → `Fase 9`

`Fase 7` (dashboard) corre en paralelo: arranca apenas exista `descartes` + `reglas_filtro` y se completa contra Fases 5 y 6.

Desde la Fase 3, los 4 clientes corren en `clipping_ensayo` en paralelo a su v3 — los números mejoran para los 4 antes de cualquier cutover.

---

## 8. Riesgos y gates

- **Gate Fase 2:** la medición de los 359 medios. Si recupera poco, v4 pierde su justificación principal.
- **Adrián / v3 en vuelo:** nada de la Fase 0 que toque los flujos de Archytas se hace sin avisarle (§9 paso 10).
- **Zonas horarias:** resolver antes de escribir una línea (§10.1). Todo se guarda en UTC, se decide en ART; una fecha sin hora nunca se compara contra un corte horario.
- **Ingesta compartida:** la Fase 3 asume los 4 catálogos migrados a `medios_fuentes`. Si se quiere un piloto de Booking aislado antes, su ingesta se construye primero y converge después — decisión a tomar al llegar a Fase 3.
- **Mandamiento 9 (autor ≠ aprobador):** cada fase que promueve a `public` o activa un workflow necesita revisión de un segundo.
- **Fuera de alcance del doc v4 y de este roadmap:** gacetillas, editor web y exportación, clientes `-legado` (§10.10).
