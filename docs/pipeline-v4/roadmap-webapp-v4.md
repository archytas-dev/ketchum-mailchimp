# Roadmap · Webapp v4

Cómo se adapta la plataforma (`ketchum-mailchimp`) para que corra sobre el pipeline v4. El **qué y el cómo** del pipeline están en [`design-doc.md`](./design-doc.md) y [`pipeline-v4.md`](./pipeline-v4.md); el plan de construcción del pipeline, en [`roadmap.md`](./roadmap.md). Este doc no los repite: cubre solo la capa que el equipo de Ketchum toca con las manos.

**Estado:** en ejecución — Pasos 0 y 1 del runbook cerrados · **Rama:** `feat/webapp-v4` (salida de `feat/pipeline-v4`) · **Relevado:** 2026-09-14 · **Actualizado:** 2026-09-15

**Avance del runbook (§3.6):** `Paso 0` ✅ → `Paso 1` ✅ → `Paso 2` ✅ → `Paso 3` ✅ → `Paso 4` ✅ → **`Paso 5`** ← acá estamos → `Paso 6` → `Paso 7`

| Paso | Ticket | Estado | Evidencia |
|---|---|---|---|
| 0 · Baseline de sólo lectura | — | ✅ 15/09 | [`auditoria/baseline-v3-20260915.md`](./auditoria/baseline-v3-20260915.md) |
| 1 · Cerrar `test` | `[W0.16]` · `[W0.16b]` · `[W0.15]` | ✅ 15/09 | [`auditoria/paso1-w016-cierre-test-20260915.md`](./auditoria/paso1-w016-cierre-test-20260915.md) |
| 2 · Plano de entrega aislado | `[W0.17]` | ✅ 15/09 | [`auditoria/paso2-w017-plano-test-v4-20260915.md`](./auditoria/paso2-w017-plano-test-v4-20260915.md) |
| 3 · Contrato e importador | `[W0.18]` | ✅ 15/09 | [`auditoria/paso3-w018-import-clipping-v4-20260915.md`](./auditoria/paso3-w018-import-clipping-v4-20260915.md) |
| 4 · Nodo n8n al destino test | `[W0.20]` · `[W0.7]` | ✅ 15/09 | [`auditoria/paso4-w020-n8n-destino-test-20260915.md`](./auditoria/paso4-w020-n8n-destino-test-20260915.md) |
| 5 · Adaptador de plano en Next.js | `[W0.19]` | **casi** — el plano se resuelve por usuario autenticado: `test@archytas.io` → `test.*_v4`; Fedra y el resto → `public`/v3. Base de Datos y Precarga bloquean también del lado servidor; la ruta heredada `/clipping/[id]` devuelve 404 para v4. Build verde; falta prueba desplegada con ambos usuarios y suite v4 completa | — |

**Lo aplicado hoy en la base** (todo versionado en `supabase/migrations/`, sin commitear):
`20260824120000` rename 24/08 que faltaba en el repo · `20260915180000` cerrar `test` ·
`20260915181000` cerrar RPC v4 · `20260915190000` plano `test.*_v4` · `20260915200000` `import_clipping_v4` ·
`20260915210000` `clipping_v4_json` · `20260915220000` `v4_test_guardar_clipping`

**Documentos nuevos:** [`valorizacion-medios-sin-tier-20260915.md`](./valorizacion-medios-sin-tier-20260915.md) — por qué 7 de cada 10 notas salen sin Ad Value, medido y repartido por dueño.

> **Nada se commiteó todavía.** Las dos migraciones están aplicadas en la base y versionadas en `supabase/migrations/`, sin commit.

---

## Índice

1. [Veredicto de viabilidad](#1-veredicto-de-viabilidad)
2. [Las tres capas](#2-las-tres-capas)
3. [Plano de datos v4: test primero, public después](#3-plano-de-datos-v4-test-primero-public-después)
4. [Fase W0 · Bloqueantes](#4-fase-w0--bloqueantes)
5. [Tab por tab](#5-tab-por-tab)
6. [Orden y camino crítico](#6-orden-y-camino-crítico)
7. [Riesgos y gates](#7-riesgos-y-gates)
8. [Lo que no se pudo verificar](#8-lo-que-no-se-pudo-verificar)

---

## 1. Veredicto de viabilidad

**Es viable, y el puente ya existe.** `armar_clipping()` devuelve un jsonb cuya forma entra casi directo en `import_clipping()`, la misma función que usa la v3 para escribir `clippings` + `notes`. No hay que inventar un contrato nuevo ni reescribir el editor.

Pero el corte no está donde uno esperaría. **De los 12 tabs, 6 no necesitan una línea de código** — necesitan que un nodo de n8n llame a `import_clipping`. Los otros 6 son un proyecto propio, y dos de ellos (Base de Datos y Actividad) están rotos *hoy*, con la v3, por razones que la v4 no causó pero que tampoco arregla sola.

**Lo que este relevamiento cambió respecto de la primera lectura:** no alcanza con conectar la v4 a la app. Hay tres cosas que hoy no funcionan y que ninguna pantalla nueva puede tapar:

1. **La explicación histórica sigue en otra tabla.** Desde el 15/09 la v4 escribe `v4_candidatas_traza` por corrida y candidata (preselección + juez, tanto en `public` como en `test`). No reemplaza `notas_descartadas`, no resuelve la divergencia previa entre evaluadores y ninguna pantalla la lee todavía. La UI no debe presentar el descarte legacy como si explicara la decisión v4.
2. **Hay dos implementaciones divergentes de las compuertas.** Medido sobre Booking el 14/09: `v4_evaluar_candidatas` —la que produce las explicaciones— dice que pasan **980**; la que realmente decide deja **65**. Construir la pantalla ahora sería mostrarle al equipo el motivo de una función que no tomó la decisión.
3. **El cruce de tiers está roto de raíz.** De las 6.481 filas de `tiers`, **0 tienen un punto en `dominio`** y **0 matchean `medios_catalogo`**. Cuatro de cada cinco filas de la tabla de medios muestran "Sin asignar" con el dato adentro de la base.

Ninguna de las tres es trabajo de front.

---

## 2. Las tres capas

La app toca la base en tres capas que se comportan de forma completamente distinta frente a la v4.

| Capa | Tablas | Estado frente a la v4 |
|---|---|---|
| **Lo que ve el equipo** | `notes`, `clippings`, `summaries`, `exports`, `activity`, `user_clipping_state` | La v4 **no escribe**. Falta 1 nodo. El contrato no cambia. |
| **Config que la app edita** | `kw_keywords`, `google_alerts`, `secciones`, `tiers` | La v4 **ya las lee directo**. Siguen funcionando. |
| **Config de medios** | `medios`, `medios_seguimiento` | La v4 usa otro modelo. **Un alta hoy no genera ningún fetch.** |
| **Telemetría** | `run_stats`, `notas_descartadas`, `medios_bloqueados` | Sin puente. La v4 escribe en otro lado y con otra forma. |

### 2.1 El puente: `armar_clipping()` → `import_clipping()`

`import_clipping(p_client_id, p_fecha, p_run_id, p_notes jsonb)` hace upsert en `clippings`, borra y reinserta las `notes` con `origen='n8n'` **preservando las manuales y precargadas**, vuelca `notes_precarga`, y dedupea contra `notas_historico_url`. Es el contrato correcto: mantenerlo significa que precarga, edición manual, export e historial siguen funcionando el día del cutover sin tocarse.

El mapeo campo a campo:

| `armar_clipping` | `import_clipping` | Acción |
|---|---|---|
| `secciones[].nombre` | `seccion` | **Aplanar** — la sección está en el contenedor |
| `titulo`, `snippet`, `url`, `medio`, `ad_value` | idem | Directo |
| `fecha_pub` (`timestamptz`) | `pub_date` (`date`) | **Cast en hora argentina** |
| — | `orden` | **Calcular** 1..N global |
| `candidata_id`, `dominio`, `fecha_confiable`, `tier`, `alcance`, `confianza`, `forzada` | — | **Se pierden** (requieren columnas nuevas) |
| `motivo_forzada` | — | Ni siquiera sale de `armar_clipping` |

**Tres cosas se rompen en silencio si el nodo se escribe sin cuidado:**

- **`orden` queda en 0 para todo.** `import_clipping` hace `coalesce((n->>'orden')::int, 0)`. Como `/hoy`, `/clipping/[id]` y `/historial` ordenan por ese campo, el orden pasa a ser el que decida Postgres — distinto entre recargas, y el mail deja de coincidir con la plataforma. Hay que numerar **global, no por sección** (el editor mueve notas entre secciones y compara `orden` entre vecinas) y **desde 1**, porque `0` es el default y hace indistinguible "sin orden" de "primera".
- **`pub_date` se corre un día.** Sin `at time zone 'America/Argentina/Buenos_Aires'`, toda nota publicada entre las 21:00 y las 24:00 ART queda con la fecha del día siguiente. Es el mismo bug de las tres horas que el roadmap del pipeline ya documenta dos veces.
- **v3 y v4 el mismo día se pisan.** `import_clipping` hace `delete from notes where clipping_id = v_clip and origen = 'n8n'` antes de insertar. Si la v3 y la v4 corren el mismo día sobre el mismo cliente, **la segunda borra las notas de la primera**, y el `editor_state` del usuario queda apuntando a notas que ya no existen. Esto convierte el rollback de la Fase 8 en una operación destructiva si se hace el mismo día.

### 2.2 La decisión que hay que tomar antes de codear

Hoy el workflow `armado-cliente` arma el mail **desde `armar_clipping` directo**, no desde lo guardado. Si eso queda así, el mail y la plataforma van a divergir de entrada: `import_clipping` aplica **su propio dedup** (contra `notas_historico_url` por `norm_url_historial`, y contra las precargadas por `norm_url` o por `txt_fold(medio)+txt_fold(titulo)`) sobre notas que la v4 ya dedupeó con `v4_keyword_norm`. **Tres normalizadores distintos sobre el mismo dato.** Una nota que el juez aprobó y que salió en el mail puede no aparecer en la plataforma.

El roadmap del pipeline ya tiene la regla escrita —*"primero se guarda, después se manda leyendo lo guardado"*— y el workflow actual no la cumple. **`[W0.7]` es esa decisión, y bloquea todo el bloque del editor.**

---

## 3. Plano de datos v4: test primero, public después

### 3.1 Decisión

La preview de la rama no escribe nunca en las tablas que hoy consumen v3. El primer destino será el schema existente `test`, pero con artefactos propios y explícitos de v4 (`*_v4`), no con las copias heredadas de v3. Cuando el resultado esté validado, se promueve **el mismo plano** a `public` con los mismos nombres (`public.clippings_v4`, `public.notes_v4`, etc.). No se promueve copiando código a mano ni se toca `public.clippings`/`public.notes` durante esa etapa.

| Plano | Puede leer | Puede escribir | Prohibido |
|---|---|---|---|
| Preview `test` | Pool y configuración compartida, sólo lectura | `test.*_v4`, corridas y trazas de test | `public.clippings`, `public.notes`, historial, precarga, config y envíos reales |
| `public_v4` de validación | Configuración compartida, sólo lectura | `public.*_v4`, corridas y trazas v4 | Tablas que usa v3 y mail a clientes |
| v3 actual | Todo lo que ya usa | Tablas actuales | Depender de artefactos v4 |

**No alcanza con una rama ni con un subdominio.** Si una preview recibe la URL/anon key del Supabase real y la app conserva sus llamadas actuales, puede editar `notes`, `activity`, `tiers`, `medios` o `google_alerts` reales. El aislamiento debe vivir en el destino de datos, en las RPCs y en las políticas, no en Git/Vercel.

### 3.2 Hallazgo de seguridad del 15/09 — `✅ cerrado el 15/09`

> **Era peor de lo que decía este párrafo, y ya no está abierto.** Evidencia completa:
> [`auditoria/paso1-w016-cierre-test-20260915.md`](./auditoria/paso1-w016-cierre-test-20260915.md).

La redacción original decía que `test` "no es apto para navegador todavía". Al ejecutar el Paso 1 se descubrió que **no era un riesgo latente: era una exposición en vivo.**

`supabase/config.toml` declara `schemas = ["public", "graphql_public"]`, pero **eso configura el stack local**; el proyecto en la nube se configura en el dashboard, y ahí `test` estaba expuesto. Con la anon key legacy —la misma que viaja en el bundle JS de la herramienta desplegada— `GET /rest/v1/<tabla>` con `Accept-Profile: test` devolvía **200** y leía `test.profiles`, `test.user_client_access`, `test.tiers` (6.480), `test.medios` (2.502) y `test.v4_candidatas_traza` (29.274). Las 32 tablas tenían `arwdDxtm` con RLS apagado en 28: también `INSERT`, `UPDATE`, `DELETE` y `TRUNCATE`.

**Segunda exposición, en `public`:** 39 funciones `SECURITY DEFINER` (`v4_*` + `armar_clipping`, `auditar_clipping`, `decidir_nivel`) eran ejecutables por `anon` sin validar `has_client_access`. Permitían leer el clipping armado de cualquier cliente pasando otro `client_id`, y `v4_abrir_run` / `v4_cerrar_run` / `v4_tomar_pagina` **mutaban estado del pipeline**.

Ambas cerradas por `[W0.16]` y `[W0.16b]`. Verificado contra la API real: todo devuelve `42501 permission denied`, y las tres RPC que usa la webapp siguen alcanzables.

**Lo que esto deja como lección para el Paso 5:** ninguna de las 39 valida acceso por cliente **adentro** de la función. Hoy da igual porque solo `service_role` las ejecuta, pero el Paso 5 expone la herramienta al plano `test` con sesión de usuario real. **Antes de ese paso, toda RPC que la app use tiene que validar `has_client_access` por dentro: el grant solo no alcanza.**

### 3.3 Mapa de superficies: qué debe tener espejo y qué queda sólo lectura

| Superficie | Hoy escribe/lee | Destino v4 de preview | Regla inicial |
|---|---|---|---|
| `/hoy`, `/historial` | `clippings`, `notes`, `activity`, `exports`, `summaries`, `user_clipping_state` | `*_v4` de esas seis tablas | Primer bloque funcional; jamás mezcla IDs v3/v4 |
| `/clipping/[id]` heredado | Escribe directo en tablas v3 desde el navegador | **404 en preview** hasta migrarlo | No se habilita parcialmente ni mezcla IDs v3/v4 |
| Precarga | `notes_precarga`, `medios`, `tiers`, `secciones` | `notes_precarga_v4`; catálogo/config sólo lectura | No puede consumir la precarga de v3 |
| Actividad | `run_stats`, `notas_descartadas`, `medios_bloqueados`, config | `v4_pipeline_runs`, `v4_candidatas_traza`, resumen v4 | Rehacer el embudo; no maquillar datos v3 |
| Panel PM | `clippings`, `notes`, `reportes`, `run_stats` | `clippings_v4`, `notes_v4`, `reportes_v4`, trazas v4 | El diff siempre compara dentro del mismo plano |
| Estadísticas | `clippings`, `notes`, `activity`, `user_clipping_state` | equivalentes `*_v4` | Después de editor/historial |
| Reportes | `reportes`, `clippings` | `reportes_v4`, `clippings_v4` | Un reporte de preview no aparece en el tablero v3 |
| Base de Datos | `medios`, `tiers`, `kw_keywords`, `secciones`, `google_alerts` | Lectura compartida al principio | **Sólo lectura** hasta diseñar doble escritura/alta v4 |

`clients`, perfiles y acceso pueden seguir siendo compartidos y de sólo lectura. La configuración será común porque la v4 ya la consume, pero la preview no podrá modificarla: cambiar keywords, medios o alertas desde una preview sería alterar la operación v3.

### 3.4 Contrato único y promoción verificable

La promoción no será “replicar lo que se acuerde”. Se construyen estas garantías desde el inicio:

1. **Contrato único de importación.** Un fixture versionado del JSON de clipping y un importador `import_clipping_v4` con `p_destino` permitido sólo como `test` o `public_v4`. El payload fija: orden global desde 1, fecha ART, secciones, URL canónica, tier/ad value, confianza, forzada y motivo.
2. **Una sola definición de esquema.** DDL parametrizado por schema/tabla, generado desde el mismo archivo de migración para `test.*_v4` y después `public.*_v4`; no dos migraciones editadas a mano.
3. **Adaptador único en la app.** Las pantallas no eligen tablas con `if` dispersos. Un repositorio de plano de datos resuelve lecturas, escrituras y RPCs server-side. En la etapa actual, el UUID autenticado de `test@archytas.io` habilita `test.*_v4`; Fedra y cualquier otro usuario quedan en `public`/v3. `KETCHUM_DATA_PLANE` sólo queda como fallback para procesos internos sin sesión y en producción no puede habilitar `test` globalmente.
4. **Auditor de paridad.** Script/migración de sólo lectura que compara, antes de habilitar `public_v4`: tablas, columnas, defaults, índices, FK, RLS, policies, grants y firmas de RPC. Si difieren, la promoción falla.
5. **Prueba de efectos.** La misma fixture corre en ambos planos y compara clipping, notas, orden, sección y metadatos. Además toma un snapshot de `public.clippings`/`public.notes` antes y después: cualquier cambio v3 hace fallar la prueba.
6. **Promoción explícita y reversible.** Crear `public.*_v4` no copia ni borra filas v3; la app se habilita por cliente y por flag. Volver atrás es volver el flag, no restaurar una base.

### 3.5 Tickets del plano de datos

| Ticket | Qué | Esf. | Dep. |
|---|---|---|---|
| `[W0.16]` | ~~**Cerrar `test` antes de exponerlo.**~~ **✅ APLICADO 15/09.** RLS + `force` en las 32 tablas, `revoke all` a `anon`/`authenticated`/`PUBLIC` sobre tablas, secuencias y funciones, y `revoke usage` del schema para `anon`. Migración `20260915180000`. Resultó ser una **exposición en vivo**, no preparación — ver §3.2 | M | — |
| `[W0.16b]` | **✅ APLICADO 15/09.** Revocar `EXECUTE` de `anon`/`authenticated`/`PUBLIC` sobre las **39** funciones v4 de `public` (`v4_*` + `armar_clipping`/`auditar_clipping`/`decidir_nivel`/`normalizar_y_compuertas`); `service_role` conserva las 39. Migración `20260915181000`. **Absorbe `[W0.15]`** | S | `[W0.16]` |
| `[W0.17]` | ~~Crear el plano de entrega `test`.~~ **✅ APLICADO 15/09.** Las 8 tablas `test.*_v4` con RLS + `force`, una policy cada una, columnas v4 desde el día uno, y **cero FK de contenido hacia `public`**. Migración `20260915190000`. Tres desvíos documentados del espejo v3: `orden` sin default, FKs que no cruzan planos, y fuera de la purga de 48 h | L | `[W0.16]` |
| `[W0.18]` | ~~`import_clipping_v4` y fixture canónico.~~ **✅ APLICADO 15/09.** Migración `20260915200000` + `supabase/fixtures/clipping_v4_bms_v1.json`. Aplana secciones, numera `orden` global desde 1, castea `fecha_pub` en ART y dedupea con `url_canonica()`. 6 pruebas negativas, idempotencia y cero mutaciones v3, verificadas. **Hace innecesario el aplanado en n8n que preveía `[W0.8]`** | L | `[W0.17]`, `[W0.5]` |
| `[W0.19]` | **CASI CERRADO.** ✅ `src/lib/data-plane.ts` (guardas 8/8) · 36 llamadas migradas en 7 pantallas · 3 embeds cross-schema eliminados · Base de Datos read-only en UI **y servidor** · Precarga read-only en test y sus acciones/RPC legado bloqueadas en servidor · recuperación de descartadas bloqueada en test · la ruta heredada `/clipping/[id]` queda en 404 en test y su export también se rechaza en servidor. ⬜ Falta migrar el editor a `*_v4`, prueba de dos usuarios y ejecutar la suite v4 completa sin procesos locales en vuelo | L | `[W0.16]`, `[W0.17]` |
| `[W0.20]` | ~~Nodo n8n test.~~ **✅ APLICADO 15/09.** `wf/armado-cliente` 46→47 nodos: nodo nuevo `Guardar clipping v4 (test)` y el que arma el mail ahora lee `clipping_v4_json()`, o sea **lo guardado**. Migraciones `20260915210000` y `20260915220000`. Verificado con corridas reales: BMS 91 notas orden 1..91, Booking 112. **Resuelve `[W0.7]`** | M | `[W0.18]`, `[W0.7]` |
| `[W0.21]` | Auditor de paridad `test` → `public_v4` y pruebas de efectos/cero mutaciones sobre v3. Debe correr en CI y antes de toda promoción. | M | `[W0.18]`, `[W0.19]` |
| `[W0.22]` | Crear `public.*_v4` desde la misma definición, activar un cliente por flag y ensayar rollback. **No es cutover a v3.** | M | `[W0.21]` |

### 3.5.1 Puerta local obligatoria antes de push a `main`

No se sube la promoción `public_v4` a `main` por inspección visual. Deben
quedar registrados estos resultados locales, en este orden:

1. **Reset reproducible.** Levantar una base local vacía y aplicar toda la
   cadena de migraciones desde cero. Si una migración histórica requiere un
   prerequisito no versionado, se corrige en el repo antes de promover.
2. **Paridad de estructura.** Comparar `test.*_v4` y `public.*_v4`, incluidos
   columnas, tipos, defaults, índices, FKs, RLS, policies, grants y RPCs. Los
   desvíos deliberados deben estar documentados; cualquier otro bloquea.
3. **Fixture pública completa.** Importar la fixture canónica en `public_v4`
   y comprobar clipping/notas/orden, fecha ART, tier, alcance, ad value,
   precarga, edición, exportación, resumen, reporte y Estadísticas.
4. **Foto de Actividad.** Con un `run_id` real, comprobar que
   `v4_public_guardar_clipping_run()` guarda entrega y proyección de cobertura,
   keywords, trazas y recuperaciones antes del mail. La UI `public_v4` no puede
   consultar tablas `test` ni las trazas legacy homónimas.
5. **Cero mutaciones v3.** Hash/conteos antes y después de cada fixture para
   `public.clippings`, `notes`, `notes_precarga`, `activity`, `exports`,
   `summaries`, `user_clipping_state` y `reportes`: cualquier diferencia falla.
6. **Permisos y selector.** Probar `anon`, usuario sin cliente, usuario interno
   y Fedra. `anon` no lee/escribe v4; Fedra sigue en v3; sólo una cuenta con
   `app_metadata.ketchum_data_plane=public_v4` accede al nuevo plano.
7. **App completa.** Ejecutar typecheck, build y la suite E2E de `/hoy`,
   Historial, Actividad, Estadísticas, Precarga, Base de Datos y Reportes.
   No se acepta una prueba verde con listas vacías.
8. **Auditoría de la reconstrucción local.** Antes de promover, comparar la
   migración local reconstruida de valorizaciones con las columnas y funciones
   del proyecto remoto en modo sólo lectura. Si difiere, se detiene y se
   versiona la corrección antes del despliegue.

Sólo después de los ocho puntos se permite crear la cuenta `testv4@archytas.io`
en remoto, con acceso interno y sin cambiar la cuenta ni los destinatarios de
Fedra. Aplicar las migraciones remotas, activar n8n o enviar un mail sigue
siendo una fase posterior con aprobación explícita.

### 3.6 Runbook para construir con un agente limitado

Esta sección es deliberadamente prescriptiva. El agente no tiene que “interpretar” cuándo es seguro avanzar: cada paso declara qué puede cambiar, qué debe verificar y qué lo obliga a parar. Hasta que una persona apruebe `[W0.22]`, **v3 vive intacta en `public` y es la única que atiende la operación real**.

#### Reglas innegociables, para pegar al inicio de cada tarea

1. Trabajar sólo en la rama `feat/webapp-v4`. No hacer merge, push a `main`, deploy de producción ni cambiar el dominio real.
2. No ejecutar ni editar migraciones que hagan `insert`, `update`, `delete`, `alter` o `drop` sobre estas entidades v3 de `public`: `clippings`, `notes`, `notes_precarga`, `notas_historico_url`, `activity`, `exports`, `summaries`, `user_clipping_state`, `reportes`, `run_stats`, `medios`, `tiers`, `kw_keywords`, `secciones`, `google_alerts`.
3. No editar `public.import_clipping`, ni agregar un nodo n8n que lo llame. El workflow v3 y sus credenciales quedan fuera de alcance.
4. No usar service-role ni secretos en código de navegador. La preview no debe tener una variable que permita elegir libremente schema o destino.
5. No apuntar Vercel a `test` hasta que `[W0.16]` esté aplicado y verificado con un usuario anónimo y uno autenticado sin acceso.
6. Si una consulta, migración o test muestra una escritura en una tabla v3 de `public`, detenerse, no “arreglarla encima”, guardar la evidencia y pedir revisión.
7. Cada cambio se entrega como: archivos modificados, comando de verificación, resultado esperado y resultado real. No se declara terminado por inspección visual.

#### Paso 0 — Baseline de sólo lectura — `✅ cerrado 15/09`

**Objetivo:** dejar evidencia de que v3 no se movió antes de empezar.

1. Confirmar rama con `git branch --show-current`; debe devolver `feat/webapp-v4`.
2. Registrar en un archivo de auditoría la fecha y los conteos/hash de las tablas v3 que el trabajo no puede tocar: al menos `clippings`, `notes`, `notes_precarga`, `activity`, `exports`, `summaries`, `user_clipping_state`, `reportes`.
3. Registrar las firmas actuales de `public.import_clipping` y de los workflows v3; no modificarlas.
4. Verificar que `.env.local` siga apuntando a local/staging, nunca copiar secretos de producción al repo.

**No seguir si:** la rama no coincide, falta acceso de sólo lectura para hacer el baseline, o hay cambios locales no identificados que pisan archivos de v3.

#### Paso 1 — Cerrar el acceso a `test` antes de usarlo en web (`[W0.16]`, `[W0.16b]`) — `✅ cerrado 15/09`

**Objetivo:** que una preview no pueda leer ni borrar datos de prueba de otro cliente ni ejecutar RPCs por adivinación de UUID.

1. Inventariar tablas, RLS, policies, grants y funciones ejecutables por `anon`/`authenticated` en el schema `test`. Incluir explícitamente `test.v4_candidatas_traza`.
2. Separar lo heredado de v3 de las tablas nuevas v4. No romper las pruebas heredadas sin documentar quién las usa.
3. Preparar una migración **aditiva y reversible** que: active RLS en las tablas v4; quite grants directos a `anon`; revoque ejecución anónima de RPCs `v4_test_*`; y exponga sólo RPCs que validen sesión + `has_client_access(client_id)`.
4. Aplicar sólo después de revisar el SQL completo. Probar cuatro casos: anónimo, autenticado sin cliente, cliente propio y staff. Los dos primeros deben recibir denegación; los dos últimos sólo sus filas.
5. Repetir el baseline v3 del Paso 0 y comparar: debe dar idéntico.

**No seguir si:** queda alguna tabla v4 visible por REST sin RLS/policy, cualquier RPC v4 es ejecutable por `anon`, o una prueba de permisos puede leer otro cliente.

#### Paso 2 — Crear el plano de entrega aislado (`[W0.17]`) — `✅ cerrado 15/09`

**Objetivo:** que la herramienta pueda guardar y editar un clipping v4 sin compartir IDs ni filas con v3.

1. Crear sólo en `test`: `clippings_v4`, `notes_v4`, `activity_v4`, `exports_v4`, `summaries_v4`, `user_clipping_state_v4`, `notes_precarga_v4`, `reportes_v4`.
2. Definir claves, FKs, índices, RLS y policies antes de agregar pantallas. Los IDs de notas/clippings v4 no pueden apuntar a `public.notes` ni `public.clippings`.
3. Agregar columnas v4 necesarias desde el día uno: `candidata_id`, dominio, fecha confiable, confianza, forzada, motivo, tier, alcance, nivel de salida y versión de pipeline.
4. Decidir y documentar retención: las corridas técnicas pueden expirar a 48 h; los clippings que revisa el equipo no se pueden borrar con esa purga.
5. Crear un script de esquema que liste columnas, índices, FK, RLS, policies y grants. Ese script será el comparador de paridad del Paso 7.

**Verificar:** insertar una fixture mínima v4 en `test`, editarla como staff, y demostrar que `public.clippings`/`public.notes` no cambiaron respecto del baseline.

**No seguir si:** la nueva tabla comparte una FK de contenido con v3, la purga de 48 h borra clippings de revisión, o el navegador escribe tablas fuera de `test.*_v4`.

#### Paso 3 — Contrato e importador únicos (`[W0.18]`) — `✅ cerrado 15/09`

**Objetivo:** que n8n y la app hablen un formato estable, y que al promover no haya que reescribir la lógica.

1. Escribir una fixture JSON versionada de BMS con varias secciones, una nota manual/precargada, fecha entre 21:00–24:00 ART, tier/ad value, confianza, forzada y motivo.
2. Construir `import_clipping_v4` para `test` únicamente. Debe aplanar secciones, calcular `orden` global desde 1 y convertir `fecha_pub` en zona ART.
3. El importador debe preservar edición y precarga **del mismo plano v4**, deduplicar con una única normalización versionada y devolver `clipping_id` v4.
4. Escribir pruebas de contrato: payload inválido falla; orden repetido falla; fecha ART queda correcta; reimportar es idempotente; nunca escribe una tabla v3.
5. Documentar un único parámetro de destino interno. En esta fase debe aceptar sólo `test`; `public_v4` se habilita recién en el Paso 7.

**No seguir si:** el mail sigue leyendo el JSON previo mientras la web lee lo importado, o si el importador toca `public.import_clipping`/tablas v3.

#### Paso 4 — Conectar n8n sólo al destino test (`[W0.20]`) — `✅ cerrado 15/09`

**Objetivo:** probar el recorrido completo: armado v4 → guardado aislado → mail de prueba desde lo guardado.

1. Agregar un nodo nuevo y explícito de importación test al workflow v4; no reutilizar ni modificar nodos v3.
2. Pasarle únicamente el `run_id` test y el payload canónico. La credencial no puede tener acceso de escritura a tablas v3 mediante ese RPC.
3. Después de importar, reconstruir el mail de prueba leyendo `test.*_v4`, no `armar_clipping` directo.
4. Ejecutar BMS en `modo=test`, verificar que el mail vaya sólo a destinatarios internos y que web/mail tengan las mismas URLs, orden y cantidad.
5. Tomar otra vez el snapshot v3 del Paso 0; debe seguir idéntico.

**No seguir si:** el workflow recibe `modo=prod`, un destinatario no interno, o una sola diferencia entre las notas guardadas y las del mail sin motivo explicado.

> #### ⚠️ Regla descubierta el 15/09: el plano v4 no puede embeber tablas de `public`
>
> ```
> PGRST200 — Searched for a foreign key relationship between 'clippings_v4' and 'clients'
> in the schema 'test', but no matches were found.
> ```
>
> **PostgREST busca la foreign key dentro del schema de la tabla y no la sigue hacia `public`.**
> No es un permiso ni una configuración: es cómo funciona. Verificado contra el stack local con
> `test` expuesto y service_role.
>
> La decisión del Paso 2 —que las FKs apunten a `public.clients` y `auth.users` para no perder
> integridad referencial— sigue siendo correcta: **la integridad existe en la base**. Lo que no
> se puede es aprovecharla desde PostgREST para traer el nombre del cliente en la misma consulta.
>
> **Regla:** ninguna consulta del plano v4 puede usar `.select("…, clients(nombre)")` ni
> equivalentes. El join se resuelve en la app, con un lookup aparte sobre `clients`.
>
> Pantallas afectadas: `/historial` (✅ resuelto), y pendientes `/hoy`, `/clipping/[id]`,
> `/panel-pm`, `/historial` ya revisada. Si esto aparecía recién al encender la preview, el
> síntoma habría sido una pantalla rota con un error que no menciona schemas cruzados.

#### Paso 5 — Adaptar la preview Vercel (`[W0.19]`)

**Objetivo:** que el equipo vea y edite sólo el plano test v4. Hasta migrar cada superficie, se bloquea: nunca se muestra una pantalla heredada que pueda escribir v3.

1. Crear un único adaptador/repository de datos; sustituir llamadas directas de las pantallas incluidas, una pantalla por PR/tarea.
2. Resolver el plano sólo del lado servidor, usando el UUID allowlisted de `test@archytas.io`: ese usuario puede ver `test.*_v4` incluso en el despliegue compartido; Fedra y todos los demás deben seguir en `public`/v3. No usar email ni un selector enviado por el navegador. La variable `KETCHUM_DATA_PLANE` no se usa como selector global de usuarios.
3. Empezar por `/hoy` y `/historial`. `/clipping/[id]` heredado se mantiene en 404 en preview hasta que su editor use `*_v4`; después Precarga, Actividad, Panel PM, Estadísticas y Reportes.
4. Base de Datos debe mostrarse read-only en preview hasta diseñar su doble escritura. Deshabilitar explícitamente botones de alta/baja/edición, no sólo ocultarlos.
5. Probar con dos usuarios: iniciar sesión como `test@archytas.io` y verificar que `/hoy`, `/historial`, `/actividad` y `/precarga` lean/escriban sólo `test.*_v4`; iniciar sesión como Fedra y verificar que vea sólo v3/public. Confirmar además que un ID v4 no se abre desde otro cliente y que ningún test modifica `public`.

**No seguir si:** queda un `.from('notes')`, `.from('clippings')` u otra escritura v3 en una pantalla habilitada para modo test; el adaptador debe ser el único punto de decisión.

#### Paso 6 — E2E y auditoría de efectos (`[W0.12]`, `[W0.21]`)

**Objetivo:** convertir “no tocamos v3” en una prueba automática, no en una promesa.

1. Arreglar primero los selectores legacy `"BMS - Versión Nueva"`; ejecutar e2e y guardar el resultado base.
2. Agregar una suite `data-plane-v4`: importar fixture, editar/reordenar, precargar, exportar, recuperar un descarte y verificar las tablas `test.*_v4` esperadas.
3. Antes/después de cada test, comparar snapshot de tablas v3. Cualquier diferencia hace fallar la suite y preserva el diff como artefacto.
4. Agregar prueba de permisos de Paso 1 y prueba de que Base de Datos no puede escribir desde preview.
5. Correr lint, typecheck/build y e2e antes de pedir revisión.

**No seguir si:** hay e2e verde con listas vacías, el snapshot v3 cambió, o faltan pruebas de permisos/paridad.

#### Paso 7 — Promover el espejo, no hacer cutover (`[W0.21]`, `[W0.22]`)

**Objetivo:** crear `public.*_v4` con el mismo contrato, sin reemplazar v3.

1. Ejecutar el auditor de paridad contra `test.*_v4`: tablas, columnas, tipos, defaults, constraints, índices, RLS, policies, grants y firmas RPC deben coincidir salvo el schema.
2. Generar `public.*_v4` desde la misma definición versionada; no copiar/pegar DDL.
3. Repetir la fixture y la suite de efectos en `public_v4`; las tablas v3 deben quedar idénticas.
4. Habilitar `public_v4` sólo para un cliente y sólo por flag reversible. Seguir sin llamar `public.import_clipping` ni enviar a clientes.
5. El cutover real a v3 queda fuera de este runbook y requiere `[W0.14]`, decisión explícita y plan de rollback aprobado.

**No seguir si:** falla paridad, falla cero-mutaciones v3, o el rollback requiere editar/borrar datos manualmente.

---

## 4. Fase W0 · Bloqueantes

Nada de lo que sigue es una pantalla. Es lo que hay que resolver para que las pantallas tengan qué mostrar.

### Datos y contrato

| Ticket | Qué | Esf. | Dep. |
|---|---|---|---|
| `[W0.1]` | **Resolver la divergencia de compuertas.** `v4_evaluar_candidatas` (980) vs `v4_candidatas_aceptadas_operativo` (65) sobre el mismo lote. O la primera pasa a ser la única fuente de verdad, o la segunda empieza a emitir motivos. Sin esto, toda explicación que muestre la pantalla es de otra función | L | — |
| `[W0.2]` | **Registrar los descartes previos al pool.** Desde el 15/09 la traza guarda lo que materializa y lo que decide A2; todavía no deja rastro de una candidata que se cae antes de materializarse. Extender la función que realmente decide, con `run_id`. | M | `[W0.1]` |
| `[W0.3]` | **A2 trazable — construido el 15/09.** El juez pide y guarda una explicación breve de cada rechazo en `v4_candidatas_traza`, aislada en test/public. Falta llevarla a la UI y resolver el auditor por candidata si éste pasa a sacar notas. | M | — |
| `[W0.4]` | Arreglar `normalizar_y_compuertas`: el `insert` omite `explicacion` y `pipeline_run_id`; falta `snippet` en `notas_descartadas`; el índice único de compuerta no incluye `pipeline_run_id`, así que con dos corridas el mismo día gana la primera | S | `[W0.2]` |
| `[W0.5]` | Migración aditiva: `notes` + `candidata_id`, `dominio`, `fecha_confiable`, `confianza`, `forzada`, `motivo_forzada`, `tier`, `alcance` (todas nullable). `clippings` + `nivel_salida`, `pipeline_version` | S | — |
| `[W0.6]` | Extender `import_clipping` para leer y persistir lo de `[W0.5]`, retrocompatible. Agregar `motivo_forzada` al jsonb de `armar_clipping` y `v4_test_armar_clipping` | M | `[W0.5]` |
| `[W0.7]` | ~~**Decisión de arquitectura:** ¿el mail se arma desde `armar_clipping` o desde lo guardado?~~ **✅ RESUELTA 15/09 por `[W0.20]`:** el mail se arma **desde lo guardado**, vía `clipping_v4_json()`. Era lo que el roadmap del pipeline ya mandaba | S | — |
| `[W0.8]` | Nodo n8n que aplane `secciones[].notas[]` → `p_notes[]`: `seccion`, `orden` global 1..N, `pub_date` casteado en ART, campos nuevos. **Es el nodo que destraba 6 tabs** | M | `[W0.6]`, `[W0.7]` |

### Retención

| Ticket | Qué | Esf. | Dep. |
|---|---|---|---|
| `[W0.9]` | `fetch_log` a 30 días (`p_logs_antiguedad='30 days'` — la función ya acepta ese rango, **no requiere DDL**, solo el parámetro del cron). Hoy `v4_fuentes_mudas` declara una ventana de 14 días sobre una tabla que se purga a los 7: **devuelve de menos sin fallar** | S | — |
| `[W0.10]` | Retención diferenciada en `notas_descartadas`: hoy el `delete` es indiscriminado a 48 h. Debe conservar 30 días las de etapa `juez`/`auditor` y **toda fila con `recuperada=true`** — son el insumo del contador de errores de reglas, y borrarlas destruye el ciclo de aprendizaje que justifica la Fase 7 | M | — |
| `[W0.11]` | Tabla `pipeline_runs_resumen`, 1 fila por `(client_id, fecha)`, escrita por el cron **antes** de purgar. `run_stats` se congela como histórico v3 | M | `[W0.10]` |

> **Por qué una tabla nueva y no `run_stats`:** su embudo no mapea a los pasos de la v4 (`post_dedup` no existe como número), `keywords_detalle` no tiene equivalente, y `medios_intentados` es por cliente cuando en la v4 la ingesta es compartida. Forzar la v4 dentro de ese esquema obliga a inventar números.

### Higiene

| Ticket | Qué | Esf. | Dep. |
|---|---|---|---|
| `[W0.12]` | ~~Arreglar la suite e2e.~~ **✅ VERDE 15/09 — 30 pasan, 0 fallan.** El diagnóstico heredado (*"5 tests buscan una opción que ya no existe"*) era la punta. Causas reales: **11 tests verificaban una UI eliminada** en el rename del 24/08 (`"Solo lectura"`, `"Se puede editar"`, `"versión anterior del clipping"` — ninguna existe en `src/`), **7 fallaban por config del seed colgada del cliente equivocado** porque la migración del rename nunca entró al repo, 1 por deriva de selector y 1 por una aserción mía demasiado amplia. **Dos de esos tests pasaban en verde verificando cosas inexistentes**, que es peor que fallar. Creada `20260824120000_rename_clientes_test_a_legado.sql` (2 bloques, idempotente, no-op en producción) | M | — |
| `[W0.13]` | ~~**`alertar-error.ts` postea a un workflow apagado.**~~ **❌ HALLAZGO ERRÓNEO — corregido 15/09.** Miré la copia del workflow que vive en la instancia **ketchum** (`4ASuwjBpfyfGx6rZ`, inactiva), pero `alertar-error.ts` apunta a `archytasai.app.n8n.cloud` — la instancia **Archytas** — donde `Ketchum — Alerta de Error (Next.js)` (`Cj0bp0hwGR5LhqFy`) está **activo**, con el mismo path `ketchum-alerta-error`. **Las alertas de la plataforma sí llegan.** Queda como mejora opcional unificar contra `v4_errores`, no como bug | S | — |
| `[W0.14]` | Guarda anti-colisión v3/v4: verificar que ningún `(client_id, fecha)` reciba escrituras de las dos el mismo día. **Bloqueante del primer cutover** | M | — |
| `[W0.15]` | ~~Revisar permisos de `armar_clipping` / `auditar_clipping` / `v4_test_armar_clipping`.~~ **✅ CONFIRMADO Y CERRADO 15/09.** Era real: 39 funciones `SECURITY DEFINER` ejecutables por `anon` sin validar `has_client_access`. Cerrado por `[W0.16b]`. **Queda el remanente:** ninguna valida acceso por cliente *por dentro* — bloqueante del Paso 5, no de ahora | S | — |
| `[W0.23]` | **Borrar la firma vieja de `v4_abrir_run` (4 argumentos).** Con las dos sobrecargas, PostgREST devuelve `PGRST203` (HTTP 300) y **falla antes de evaluar permisos**. Hoy no molesta porque el armado manda `p_rehacer`, pero cualquier llamador que lo omita recibe un 300 que no dice "falta un parámetro" | S | — |

---

## 5. Tab por tab

### 5.1 Principal (`/hoy`) — el editor del día

**Hoy lee** `clippings` (todos, sin límite de fecha), `notes` (`incluida=true`, `order orden`), `user_clipping_state`, `summaries`. **Escribe** `activity`, `user_clipping_state`, `exports`, `clippings.estado`, `summaries`.

**Con la v4 no se rompe nada** — si `[W0.8]` está bien hecho. El autoguardado, el export y la generación de resumen son independientes del pipeline.

**Lo que gana:** es la pantalla donde los campos nuevos de la v4 valen más, porque es donde el equipo decide qué sale.

| Ticket | Qué | Esf. |
|---|---|---|
| `[W1.1]` | Traer los campos nuevos en la query y pasarlos al payload del editor | S |
| `[W1.2]` | `editor.js`: `toNota` acepta `confianza`, `forzada`, `motivo_forzada`, `fecha_confiable`, `alcance`, `dominio` | M |
| `[W1.3]` | **Chip de confianza** en la cabecera de cada nota (`<0.70` ámbar, `<0.85` gris, `≥0.85` sin chip). Hoy el editor revisa 40 notas con el mismo peso; el chip dice *"a esta el juez la dudó"* y concentra la lectura | M |
| `[W1.4]` | **Badge "Forzada"** con tooltip = `motivo_forzada`. Una forzada entró *contra* el veredicto del juez porque una regla dura lo pisó. Sin el badge, el editor la borra y nadie se entera de que la regla sobre-dispara | M |
| `[W1.5]` | Fecha en gris + tooltip cuando `fecha_confiable=false`. Hoy el editor no distingue una fecha del feed de una adivinada del slug de la URL, y mandar una nota vieja con fecha de hoy es un reclamo | S |
| `[W1.6]` | Barra superior: `"$X Ad Value · N sin valorizar · M forzadas"` — los tres salen de la raíz de `armar_clipping` | S |
| `[W1.7]` | **Franja de nivel de salida** (staff), con el motivo literal de `decidir_nivel`. Hoy, si el juez se cayó y salió el filtro determinístico solo, el editor abre `/hoy` y ve un clipping que parece normal. Nivel 3 debe bloquear el export | M |
| `[W1.8]` | Acotar la query de clippings (hoy trae el histórico entero y se queda con el primero por cliente) | S |
| `[W1.9]` | Fallback de medio: si viene el dominio pelado, capitalizar. Los renders v3 ya lo hacen; el editor no, y va a mostrar `ejemplo.com.ar` | S |
| `[W1.10]` | `alcance` junto al Ad Value en exclusivas — **bloqueado**: ningún documento define qué es `alcance` ni en qué unidad está | — |

### 5.2 Historial

**Hoy lee** `clippings`, `exports`, `notes`. Reconstruye el lookup de tier desde `notes.ad_value` + `tierNorm(medio)`.

**Con la v4 no cambia nada.** Es la pantalla más barata de todas.

| Ticket | Qué | Esf. |
|---|---|---|
| `[W2.1]` | Importar `tierNorm` de `@/lib/tier` en vez de la copia local duplicada en `actions.ts` | S |
| `[W2.2]` | Cruzar ad value por `notes.dominio` cuando exista, con fallback al nombre | S |
| `[W2.3]` | Columna "Nivel" junto a `estado` — permite responder *"¿qué pasó el martes?"* sin entrar a n8n | M |
| `[W2.4]` | **Renderer de MARS.** Hoy no existe y cae a `genericHtml`; MARS es uno de los cutovers de la Fase 9. Independiente de la v4 | L |

### 5.3 Editor por clipping (`/clipping/[id]`)

Es la **única pantalla que escribe `notes` directo desde el navegador** (`incluida`, `orden`, `pintada`), con la RLS del usuario.

| Ticket | Qué | Esf. |
|---|---|---|
| `[W3.1]` | **Decidir el futuro de esta pantalla.** Duplica `/hoy` con un modelo distinto (una escribe `notes`, la otra `editor_state`). Mantener las dos en la v4 es doble trabajo en cada ticket. **Puede cancelar los demás tickets del bloque** | S |
| `[W3.2]` | Mostrar confianza/forzada en los controles inyectados | M |
| `[W3.3]` | Guarda: no reordenar si todas las notas tienen `orden=0` (evita swaps que no hacen nada) | S |

> **Deuda que la v4 empeora:** el borrado y reinserción de `origen='n8n'` descarta el `incluida=false` que el usuario ya había puesto. Hoy pasa igual con la v3, pero la v4 reintenta páginas, así que la frecuencia sube. Ticket aparte.

### 5.4 Precarga

**No cambia con la v4.** `preload_notes` y `notes_precarga` siguen igual, e `import_clipping` los vuelca como hoy.

| Ticket | Qué | Esf. |
|---|---|---|
| `[W4.1]` | Secciones desde la tabla `secciones` en vez de `canon.ts` hardcodeado | M |
| `[W4.2]` | Autocompletado de medio contra `medios_catalogo` (1.588 dominios) además de `medios`/`tiers` | M |
| `[W4.3]` | Aviso cuando se precarga con fecha = hoy y el clipping del día ya corrió (la fila queda huérfana) | M |
| `[W4.4]` | Mostrar `alcance` en exclusivas — **bloqueado** por lo mismo que `[W1.10]` | — |

### 5.5 Base de Datos

La pantalla con más trabajo, y la única que está **rota hoy**, con la v3.

#### Medios de nicho / Medios generales

**Confirmado: un alta desde la app no genera ningún fetch en la v4.** No hay trigger de sincronización `medios` → modelo v4. La v4 recolecta desde `medios_fuentes ⋈ medios_estrategia`; `medios` solo aparece para marcar prioridad y `fuente_monitoreada` sobre fuentes **que ya existen**. Un dominio nuevo en `medios` es invisible para el pipeline, para siempre.

La buena noticia: **la migración histórica ya se hizo.** De los 374 dominios de `medios` sin fila en `medios_fuentes`, 332 son basura `sin-dominio:*` y el resto son de clientes `-legado` que ni siquiera son seleccionables. Para los cuatro clientes vivos el único hueco real son 169 filas basura de MSD. **Lo que falta es el camino de escritura hacia adelante, no los datos.**

| Ticket | Qué | Esf. |
|---|---|---|
| `[W5.1]` | `normalizarDominio()` compartida TS+SQL, idéntica a la de `v4_fuentes_prioritarias`; rechazar el alta si queda vacío en vez de escribir `sin-dominio:*` | S |
| `[W5.2]` | Limpiar las 332 filas `sin-dominio:*` | S |
| `[W5.3]` | **Sonda de alta `[F7.5]`**: escalera de 5 transportes + reintento Bright Data, escribe `fetch_log` con `pasada='sonda_alta'`, devuelve 3 titulares reales en menos de un minuto. Es un servicio HTTP (workflow n8n o Edge Function), no una server action | L |
| `[W5.4]` | `addMedioV4()` transaccional (un RPC, no 4 llamadas PostgREST): catálogo → estrategia → fuente → suscripción | M |
| `[W5.5]` | UI del alta con preview de la sonda y sus tres estados: anda / anda a medias / no se puede | M |
| `[W5.6]` | Doble escritura `medios` + modelo v4 hasta el cutover de los cuatro | S |
| `[W5.7]` | Baja y bloqueo a `medios_suscripcion.bloqueado` + `motivo_bloqueo` (no a `medios_bloqueados`, que tiene 0 filas y ninguna función v4 la lee) | S |
| `[W5.8]` | **Que `vigente_desde` se respete.** La columna existe con default, y **ninguna función v4 la consulta**: el requisito *"se aplica en el próximo clipping, nunca sobre uno enviado"* no está implementado — hoy un bloqueo aplica instantáneamente | M |
| `[W5.9]` | Resolver los 177 dominios con estrategia sin transporte y los 103 del catálogo sin estrategia: cola de A0 con vista en la UI | M |
| `[W5.10]` | Vista por fuente: agregar/quitar secciones de un dominio. 1.219 de 1.588 ya están desglosados | L |

#### Tiers y Ad Value

**El cruce está roto de raíz, y no por variantes ortográficas.** De las 6.481 filas de `tiers`, **0 tienen un punto en `dominio`** y **0 matchean `medios_catalogo.dominio_norm`**. La columna se llama `dominio` y guarda el nombre del medio pasado por `tierNorm()`, una función JS que colapsa `.` a espacio y borra los tokens `com`/`ar`.

**Hay tres normalizadores distintos para la misma clave, y no coinciden:** `tierNorm()` en TS (el que *escribe*), `tier_norm()` en SQL (el que lee en `armar_clipping`) y `v4_email_tier_norm()` en SQL (el que lee en el mail). Dos bugs concretos:

- **`armar_clipping` usa el normalizador equivocado.** Une `tier_norm(t.dominio) = tier_norm(coalesce(mc.nombre, c.dominio_norm))`, pero `t.dominio` ya viene pasado por `tierNorm()` (JS), que borra tokens que `tier_norm()` conserva. *"Diario Río Negro"* queda como `"rio negro"` en `tiers` y como `"diario rio negro"` del otro lado. **No matchea.** Cobertura de ese join: **175 de 1.588 dominios (11,0 %)**.
- **`v4_email_tier_norm` no colapsa espacios múltiples**, así que difiere de `tierNorm()` cada vez que un token borrado queda en el medio.

Resultado en pantalla: **cuatro de cada cinco filas de la tabla de medios muestran "Sin asignar"**, con 6.481 filas de tier en la base.

> **De dónde viene.** `tierNorm()` es copia literal del Code node "Build Tier Lookup" de la v3, que existía para cruzar el Excel de Fedra —que no tenía columna de dominio— contra los nombres de las notas. **El algoritmo sobrevivió a la fuente de datos que lo justificaba.** El bug del Ad Value no es de lectura: es que seguimos indexando por nombre normalizado cuando el formulario tiene el dominio en la mano y lo descarta.

| Ticket | Qué | Esf. |
|---|---|---|
| `[W5.11]` | **Unificar el normalizador** en una sola función SQL y corregir el join de `armar_clipping`. ⚠️ **Medido el 15/09 — ver [`valorizacion-medios-sin-tier-20260915.md`](./valorizacion-medios-sin-tier-20260915.md).** El encuadre anterior (*"el dato existe y no cruza"*) era optimista: recupera **863 notas de 6.688** (30% → 43%), no el total. El 42% son medios que **nunca se valorizaron** y eso no lo arregla el código. Y **sólo mejora el camino v4**: la v3 hace el cruce en un Code node de n8n | S | — |
| `[W5.12]` | `tiers.dominio_norm` + FK a `medios_catalogo` + único `(client_id, dominio_norm)` | S |
| `[W5.13]` | Backfill por nombre. Techo del automático: ~250 de 808 filas por cliente; el resto necesita alias o queda sin dominio | M |
| `[W5.14]` | `updateMedioTier` escribe `dominio_norm`; `listMedios` cruza por dominio con fallback a nombre | M |
| `[W5.15]` | Selector sobre `medios_catalogo` en el alta, en vez de nombre libre | M |
| `[W5.16]` | Sub-tab **"Sin valorizar"**: los 3.354 de 3.989 sin tier, ordenados por volumen, asignación inline | M |
| `[W5.17]` | Sub-tab **"Alias"** sobre `tier_alias` — y antes, **hacer que alguien la lea**: 0 filas, 0 lectores, infraestructura muerta | M |
| `[W5.18]` | Editor de `tier_defaults` (4 valores por cliente; hay 12 filas sobre 32 posibles, o sea huecos) | S |

#### Palabras clave · Secciones · Google Alerts

Las tres sobreviven casi intactas: la v4 las lee directo. Lo que cambia es más chico de lo que parece, pero no es cero.

| Ticket | Qué | Esf. |
|---|---|---|
| `[W5.19]` | **Keywords: la columna "Sección" dejó de ser funcional.** En la v3 el `grupo` armaba el mapa keyword→sección; en la v4 la keyword solo sirve como *ancla de relevancia* y a qué sección va lo decide el A2. Retirarla o marcarla como informativa. Exponer `notas` y `visible_cliente` | S |
| `[W5.20]` | **Secciones: exponer y editar `alias`.** Está poblado en las 28 filas y **no lo lee ninguna función**. `armar_clipping` matchea por nombre exacto y case-sensitive: los alias son exactamente lo que va a tolerar la variación de nombres que devuelve el A2. También `es_exclusiva` y `muestra_ad_value`, que se leen y no son editables | M |
| `[W5.21]` | Que `armar_clipping` use `secciones.alias` además del match exacto | S |
| `[W5.22]` | Google Alerts: exponer `notas`, filtro activas/inactivas (**62 de 196 están inactivas** y no se ven como tales), y última vez que trajo algo desde `fetch_log` | M |

#### Seguimiento

**Muere.** `medios_seguimiento` tiene **0 filas** desde su creación, ninguna función SQL la referencia y nadie la lee fuera de su propia pantalla. Lo que la reemplaza son dos cosas distintas que la tabla confundía: *"el medio no trajo nada"* → salud de fuentes (`[W6.7]`); *"la nota salió y no la vimos"* → notas que no entraron (`[W6.2]`).

| Ticket | Qué | Esf. |
|---|---|---|
| `[W5.23]` | Retirar la sub-tab. Dejar la tabla (0 filas, no molesta). Reversible por definición | S |

#### Changelog

`config_changelog` tiene 188 filas y **ninguna `medios:alta`**. La causa está en la primera línea del trigger: `if auth.uid() is null or is_staff() then return ...` — **solo registra a usuarios no-staff**. Como Fedra es staff y n8n corre con service role, lo único que queda logueado es lo que hace un usuario de rol cliente.

Además el trigger no se puede colgar del modelo v4 tal cual: `medios_catalogo` y `medios_estrategia` **no tienen `client_id` ni `id`** (sus PKs son `dominio_norm text`), y `reglas_filtro.client_id` es nullable contra un `NOT NULL` en `config_changelog`.

| Ticket | Qué | Esf. |
|---|---|---|
| `[W5.24]` | `config_changelog.client_id` nullable + `registro_clave text` | S |
| `[W5.25]` | Reescribir `log_config_change` con `to_jsonb(new)->>'…'` en vez de `new.id` literal | S |
| `[W5.26]` | **Decidir la política:** si `[F7.6]` quiere *"toda alta/baja/bloqueo/tier con fecha de vigencia"*, hay que sacar el `is_staff()` y dejar que el RLS de lectura sea el que esconda las cosas del cliente | S |
| `[W5.27]` | Trigger en las 7 tablas v4 + `secciones` + `google_alerts` (hoy tres de las seis sub-tabs escriben sin auditoría) | S |
| `[W5.28]` | Changelog explícito del alta de medio: 1 fila semántica en vez de 4 de trigger | S |

### 5.6 Actividad

La segunda pantalla con más trabajo. Todo su contenido sale de `run_stats` y `notas_descartadas` de la v3, y la v4 no escribe ninguna de las dos.

**El embudo hay que redefinirlo, no traducirlo.** Dos pasos de la v3 no tienen equivalente:

- **`medios_intentados` / `notas_fetched` por cliente**: en la v4 la ingesta es una sola para los cuatro. `fetch_log` y `candidatas_raw` no tienen `client_id`.
- **`post_dedup` como paso separado**: la v4 deduplica en tres lugares (índice único en la ingesta, `row_number()` por título, anti-repetición de 30 días) y **ninguno deja rastro contable**.

El embudo v4, medido el 14/09:

| Cliente | fuentes int. | fuentes ok | pool crudo | post-compuertas | juzgadas | post-IA | notas finales |
|---|---|---|---|---|---|---|---|
| BMS | 7.758 | 6.202 | 98.095 | 1.032 | 1.032 | 65 | 52 |
| Booking | 7.758 | 6.202 | 98.095 | 64 | 64 | 23 | 23 |
| Mars | 7.758 | 6.202 | 98.095 | 39 | 39 | 20 | 20 |
| MSD | 7.758 | 6.202 | 98.095 | 45 | 45 | 6 | 6 |

| Ticket | Qué | Esf. |
|---|---|---|
| `[W6.1]` | Nuevo embudo sobre `pipeline_runs_resumen`, con los pasos de la v4 (`suscritas → post-compuertas`) en vez de los de la v3 | L |
| `[W6.2]` | **`[F7.1]` Notas que no entraron:** tarjetas con etapa, regla, `valor_que_matcheo` y explicación; filtros por medio y por motivo | M |
| `[W6.3]` | RPC `reclamar_descarte(id, seccion)`: inserta en `notes`, marca `recuperada`, e **incrementa `reglas_filtro.reclamos_asociados`**. Tiene que ser RPC `SECURITY DEFINER` porque el RLS de `reglas_filtro` es staff-only | M |
| `[W6.4]` | `RecuperarButton` con selector de sección (hoy inserta `seccion: null`) y snippet | S |
| `[W6.5]` | Bug: el botón de recuperar toma `order fecha desc limit 1` sin filtrar por fecha. Si el clipping de hoy no se generó, **la nota cae en el de ayer, en silencio** | S |
| `[W6.6]` | **`[F7.2]` Reglas de filtrado.** Ojo con tres cosas: `antiguedad` y `titulo_corto` no son reglas sino *parámetros* y no pueden ir en la misma tabla; hay **tres excepciones hardcodeadas en el SQL** que no están en `reglas_filtro` y van a hacer mentir los contadores; y `peso` está en el esquema pero **no lo lee ninguna función** — no exponerlo hasta que el scoring exista | M |
| `[W6.7]` | **`[F7.3]` Salud de fuentes** sobre `v4_fuentes_mudas` (155), `v4_estrategia_a_reverificar` (19), `v4_cobertura_dia` y `v4_barrido_resumen`. La columna principal es `articulos`, no `diagnostico='ok'`: hay 8.318 `sin_items` que son *"respondió y no trajo nada"* | M |
| `[W6.8]` | `medios_fuentes.notas_30d` está en **0 en las 2.987 filas** y nadie lo escribe. Cron diario desde `fetch_log` — depende de `[W0.9]` | M |
| `[W6.9]` | **`[F7.4]` Medios sin valorizar** — es la misma lista que `[W5.16]`, vista desde el otro lado. Unificar, no duplicar | M |
| `[W6.10]` | Sección "Errores" (staff) sobre `v4_errores` (58 filas, la app no las lee) con toggle de `ignorado` | S |
| `[W6.11]` | Nivel de corrida en la tira de "Última corrida" + histórico de 14 días | S |
| `[W6.12]` | Costo de IA desde `v4_llm_consumo_dia` — **bloqueado**: `stage_events` tiene 0 filas, ningún workflow escribe ahí | — |
| `[W6.13]` | Bloque "Palabras clave con match": **sin equivalente v4**, ninguna tabla guarda qué keyword matcheó qué candidata. Decidir si se retira o si la v4 empieza a registrarlo | — |
| `[W6.14]` | Corregir `MOTIVO_LABEL`/`FASE_LABEL`: mapean 2 motivos y 2 fases; la v4 tiene 9 motivos y 3 etapas | S |
| `[W6.15]` | Arreglar `v4_salud`: el `esperado_mismo_dia_semana` mira 4 fechas del mismo día de la semana en `candidatas_raw`, y con la purga de 48 h **hay 4 fechas en total**. El cálculo ya está roto | S |

### 5.7 Estadísticas

Métrica de uso humano, no del pipeline. **No cambia con la v4.**

| Ticket | Qué | Esf. |
|---|---|---|
| `[W7.1]` | **Bug latente:** se le pasa `nombre` a `canonSection`, que espera slug. Funciona **por accidente** (el match es por substring y los nombres actuales contienen el slug). Un cliente que se llame distinto manda las estadísticas al tema equivocado, en silencio | S |
| `[W7.2]` | Acotar la query de clippings (hoy trae el histórico completo) | S |
| `[W7.3]` | Panel "Calidad del juez": distribución de confianza, % forzadas, notas sin fecha confiable | L |
| `[W7.4]` | Tarjeta de niveles de salida de los últimos 14 días | M |

### 5.8 Panel PM

**No se rompe** — el diff sigue usando `origen='n8n'` como base, e `import_clipping` lo mantiene. Pero se degrada en dos puntos:

| Ticket | Qué | Esf. |
|---|---|---|
| `[W8.1]` | "Costo IA del día" sale de `run_stats`, que la v4 no escribe: **al cutover pasa a mostrar `—` para siempre**. No falla, miente por omisión | M |
| `[W8.2]` | El diff cruza contra `notas_descartadas` para distinguir *"el cliente agregó algo que descartamos a propósito"* de *"algo que no vimos"*. Con `[W0.2]` sin resolver, **toda nota agregada se cuenta como nueva** — justo la señal que el panel existe para dar | M |
| `[W8.3]` | Columnas `confianza` y `forzada` en las filas rojas: contesta si mandamos la nota con confianza alta (error de criterio) o baja (el juez ya dudaba y no lo escuchamos). Eso decide si se toca el prompt o la regla | M |
| `[W8.4]` | Match secundario por `dominio` cuando la normalización de URL no cruza | M |
| `[W8.5]` | El test de Panel PM **pasa verde con listas vacías**. Hacer que falle | S |

### 5.9 Reporte de errores

**No depende de v3 ni de v4.** Nada obligatorio.

| Ticket | Qué | Esf. |
|---|---|---|
| `[W9.1]` | Guardar `candidata_id` al reportar sobre una nota: es la única forma de volver de un reporte al veredicto, al prompt que la juzgó y al `fetch_log` que la trajo | M |
| `[W9.2]` | Mostrar el nivel de salida de la corrida del día reportado, como contexto para quien hace el triage | S |
| `[W9.3]` | **Cerrar el lazo:** el ticket que creó esta pestaña decía que servía *"para que el equipo técnico lo revise, lo corrija y ajuste la configuración base"*. La primera mitad se construyó; la segunda es conectar el reporte contra `reglas_filtro` | M |

### 5.10 Transversales

| Ticket | Qué | Esf. |
|---|---|---|
| `[W10.1]` | `canon.ts`: secciones desde la tabla, no hardcodeadas. Los `ALIAS` quedan muertos con la v4 (que ya entrega el nombre canónico) y son código que se lee como si protegiera algo | L |
| `[W10.2]` | **Una sola normalización de URL.** Hoy hay 3 en el código y 3 en SQL | L |
| `[W10.3]` | `NivelBadge.tsx` nuevo. No reusar `EstadoBadge`: es binario y es un `<button>` con `onClick` obligatorio; el nivel es una escalera de 4 valores y no es accionable | S |
| `[W10.4]` | Unit test: `sectionsFor(slug)` == secciones activas de la tabla, para los 4 clientes. Hoy coinciden exactamente — el test es para que sigan coincidiendo | S |

---

## 6. Orden y camino crítico

**Hay dos caminos críticos que no se deben mezclar.** Para explicar/recuperar notas: `[W0.1] → [W0.2] → [W6.3] → [W6.6]`. Para poner la herramienta sobre v4 sin tocar v3: `[W0.16] → [W0.17] → [W0.18] → [W0.19] → [W0.20] → [W0.21] → [W0.22]`.

En paralelo, **`[W0.8]` es el ticket de mayor rendimiento de todo el roadmap**: un nodo de n8n destraba 6 tabs sin tocar una línea de la app.

### Lo que se puede hacer hoy, sin esperar nada

Estos no dependen del cutover ni de que la v4 escriba en `public`:

- `[W5.11]` — medio día, corrige un join equivocado **en producción**
- `[W0.12]` suite e2e · ~~`[W0.13]` alertas al vacío~~ *(hallazgo erróneo, ver ficha)* · `[W0.9]` retención de logs
- `[W5.1]`, `[W5.2]` — paran la hemorragia de `sin-dominio:*`
- `[W5.24]`–`[W5.27]` changelog — barato y habilita el historial de configuración
- `[W7.1]`, `[W6.5]`, `[W6.14]`, `[W10.3]`, `[W10.4]`, `[W2.1]`
- `[W5.3]` la sonda, que es lo más largo y no depende de nadie
- La maqueta de `[W6.1]` y `[W1.7]` puede usar datos de test **sólo después de `[W0.16]`**; hoy el schema no es seguro para navegador

### Lo que solo se puede hacer después del cutover de un cliente

`[W1.7]` con datos reales, `[W2.3]`, `[W7.3]`, `[W7.4]`, `[W8.1]`, `[W8.3]`, `[W8.4]`, `[W9.1]`.

### Lo que está bloqueado por una decisión, no por código

| Bloqueado | Espera |
|---|---|
| `[W1.10]`, `[W4.4]` | Qué significa `alcance` y en qué unidad |
| `[W3.2]`, `[W3.3]` | `[W3.1]`: si `/clipping/[id]` sobrevive |
| `[W6.12]` | Que algún workflow escriba `stage_events` |
| `[W6.13]` | Si la v4 registra el match de keyword o se retira la métrica |
| Editor v4 en preview | `[W0.16]`–`[W0.20]`: plano test seguro, importador y adaptador |
| Todo el bloque del editor en `public_v4` | `[W0.7]` + `[W0.21]`: mail desde lo guardado y paridad comprobada |

---

## 7. Riesgos y gates

| # | Riesgo | Severidad | Cubierto |
|---|---|---|---|
| R1 | `orden`=0 → orden no determinístico; mail ≠ plataforma | Alta, silenciosa | No. Test nuevo |
| R2 | `pub_date` corrido un día por cast sin zona horaria | Alta, silenciosa | No |
| R3 | Triple dedup hace desaparecer notas que el juez aprobó | Alta | No. Depende de `[W0.7]` |
| R4 | v3 y v4 escriben el mismo `(client_id, fecha)` → la segunda borra a la primera | Alta, **destructiva** | `[W0.14]`. No es testeable con Playwright |
| R5 | Pantalla de reglas mostrando contadores de una función que no decide | Alta | `[W0.1]` |
| R6 | Panel PM cuenta como "agregada" una nota que descartamos a propósito | Media | `[W0.2]`. El test **pasa verde con datos rotos** |
| R7 | `canon.ts` desincronizado de `secciones` → notas a la sección equivocada | Media, silenciosa | `[W10.4]` |
| R8 | Permisos de `armar_clipping` — ver §7 | Alta si se confirma | `[W0.15]` |
| R9 | Preview web expone o deja escribir el schema `test` heredado | Alta, seguridad y datos | `[W0.16]` |
| R10 | Preview v4 edita keywords, medios, tiers o alertas compartidas y cambia la operación v3 | Alta, silenciosa | `[W0.19]` |
| R11 | Test y `public_v4` divergen por una migración/RPC editada a mano | Alta, silenciosa | `[W0.21]` |

**Gates:**

1. **Nada se construye sobre `[F7.1]`/`[F7.2]` antes de `[W0.1]`.** Mostrar la explicación de una función que no decidió es peor que no mostrar nada: instala una creencia falsa sobre por qué el sistema hace lo que hace.
2. **`[W0.16]` antes de poner cualquier preview en manos del equipo.** Una URL Vercel no convierte `test` en seguro.
3. **`[W0.21]` antes de crear/activar `public_v4`.** La paridad y el snapshot de cero mutaciones v3 son obligatorios.
4. **`[W0.14]` antes del primer cutover a las tablas de v3.** Es el riesgo destructivo de la lista.
5. ~~**Suite e2e verde antes de tocar `/hoy` o `/clipping/[id]`.**~~ **✅ DESTRABADO 15/09** — 30 pasan, 0 fallan. Detalle en `[W0.12]`.

---

## 8. Lo que no se pudo verificar

- ~~**Permisos de `armar_clipping` / `auditar_clipping` / `v4_test_armar_clipping`.**~~ **Verificado y cerrado el 15/09** — ver §3.2 y `[W0.16b]`.
- ~~**Seguridad del schema `test`.**~~ **Verificado y cerrado el 15/09** — era exposición en vivo, no riesgo. Ver §3.2.
- **Que el pipeline sobreviva a `[W0.16b]`.** La credencial de n8n quedó probada como `service_role` (el recolector escribe `fetch_log` por POST directo, esa tabla tiene RLS con policy `is_staff()`, y recibió 7.698 filas el 15/09 — solo un rol con `BYPASSRLS` pudo hacerlo). Pero **el barrido no volvió a correr desde la migración**: la confirmación empírica es que `fetch_log` sume filas en la corrida siguiente. Si no suma, el DOWN de `20260915181000` revierte.
- **Cobertura de ad value sobre `notes` de los últimos 30 días.** Timeouts repetidos. Los 15,9 % → 36,4 % del diseño quedan como dato del documento, no reconfirmado.
- **Si la v4 escribe `notas_descartadas` desde algún workflow que no sea `armado-cliente`.** El armado no tiene ningún nodo que lo haga; no se recorrieron los 42 workflows uno por uno.
- **Por qué `prioritario` (80/97/86/71) no coincide con `tipo='monitoreado'` (66/88/91/91).** Hay un desajuste real en la migración; no se identificó el origen.
- **Qué significa `alcance`.** Ningún documento lo define. Sale literal de `tiers.alcance` y el render de MSD lo imprime en el mail.
- **Si `public.armar_clipping` va a ser la del cutover, o si se promueve `v4_test_armar_clipping`.** Hoy la primera no tiene datos y la segunda es la que corre.
- **Cuál es la fecha de corte real de la suite e2e.** Se verificó la causa (el rename del 24/08), no se corrió `npx playwright test`.
- **`docs/pipeline-v4/` tiene corte el 11/09.** Hay migraciones posteriores no documentadas (el filtro de BMS a 0,85 de confianza, verificado en la base; y tres del 14/09 que cambian el filtrado por suscripción y país). **El filtrado de la v4 de hoy no es el que describe el diseño.**
