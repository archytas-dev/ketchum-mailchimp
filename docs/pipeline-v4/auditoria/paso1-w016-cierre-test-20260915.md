# Paso 1 · `[W0.16]` — Cierre del schema `test`

Ejecutado 2026-09-15. Runbook: [`roadmap-webapp-v4.md` §3.6, Paso 1](../roadmap-webapp-v4.md).
Baseline previo: [`baseline-v3-20260915.md`](./baseline-v3-20260915.md).

---

## 1. Lo que se encontró: exposición en vivo, no deuda técnica

§3.2 del roadmap decía que `test` "no es apto para navegador todavía". Es peor: **estaba
expuesto en la Data API de producción y era legible y escribible con la anon key.**

`supabase/config.toml` declara `schemas = ["public", "graphql_public"]`, pero **eso configura el
stack local**. El proyecto en la nube se configura en el dashboard, y ahí `test` estaba incluido.

Verificado el 15/09 contra `https://banlcbewinpjtudzdzhm.supabase.co/rest/v1` con la anon key
legacy (la misma que viaja en el bundle JS de la herramienta desplegada):

| Pedido | Antes |
|---|---|
| `GET /notes` sin `Accept-Profile` (schema `public`) | **401** — la RLS de `public` funcionaba bien |
| `GET /notes` con `Accept-Profile: test` | **200** |

Conteos leídos con esa key, sin ninguna credencial privilegiada:

| Tabla | Filas expuestas |
|---|---:|
| `test.v4_candidatas_traza` | 29.274 |
| `test.tiers` | 6.480 |
| `test.medios` | 2.502 |
| `test.kw_keywords` | 252 |
| `test.user_client_access` | 16 |
| `test.clients` | 8 |
| `test.profiles` | 2 |

Las 32 tablas tenían `arwdDxtm` para `anon` y `authenticated`, con RLS apagado en 28 de ellas:
además de leer, permitía `INSERT`, `UPDATE`, `DELETE` y `TRUNCATE`. No se probó escribiendo
antes de cerrar; los grants son prueba suficiente.

---

## 2. Chequeo previo que evitó romper el pipeline

La migración usa `force row level security`, que hace que **el dueño de la tabla también quede
sujeto a la RLS**. Las `v4_test_*` son `SECURITY DEFINER` de `postgres` y escriben esas tablas:
si `postgres` no tuviera `BYPASSRLS`, el `force` habría roto el armado v4 esa misma noche.

Verificado antes de aplicar: `postgres` y `service_role` tienen `rolbypassrls = true`, y todas
las tablas de `test` son de `postgres`. El `force` es seguro.

---

## 3. Migración aplicada

`supabase/migrations/20260915180000_w016_cerrar_schema_test.sql`

1. RLS + `force` en las 32 tablas (sin policies = denegación total salvo owner/BYPASSRLS).
2. `revoke all` sobre tablas y secuencias para `anon`, `authenticated` y `PUBLIC`.
3. `revoke usage on schema test` para `anon` y `PUBLIC`; se conserva para `authenticated` (lo
   va a necesitar `[W0.17]`) y `service_role`.
4. `revoke all` sobre las funciones de `test`; `grant execute` explícito a `service_role`.
5. `alter default privileges` para que lo que se cree después no nazca abierto.

**No incluye** el `revoke` del `EXECUTE` sobre los envoltorios `public.v4_test_*`: eso es
`20260915181000_w016b`, todavía sin aplicar (ver §6).

---

## 4. Verificación posterior

### 4.1 La anon key ya no entra — lectura y escritura

| Pedido | Después |
|---|---|
| `GET test.profiles` | **401** `42501 permission denied for schema test` |
| `GET test.tiers` | **401** `42501` |
| `GET test.medios` | **401** `42501` |
| `GET test.user_client_access` | **401** `42501` |
| `GET test.v4_candidatas_traza` | **401** `42501` |
| `PATCH test.kw_keywords` (filtro que no matchea nada) | **401** `42501` |
| `POST test.profiles` | **401** `42501` |

### 4.2 Los clippings reales de hoy, intactos

Los cuatro escriben en `public`, no en `test`:

| Cliente | Fecha | Notas | Última nota (ART) |
|---|---|---:|---|
| Mars | 2026-09-15 | 76 | 06:51 |
| Booking | 2026-09-15 | 71 | 07:19 |
| BMS | 2026-09-15 | 57 | 07:23 |
| MSD | 2026-09-15 | 36 | 07:41 |

### 4.3 Baseline v3 sin cambios

Re-ejecutado el hash acotado al corte del baseline. **Los ocho coinciden exactamente:**
`clippings`, `notes`, `notes_precarga`, `activity`, `reportes` (acotados), y `tiers`, `medios`,
`secciones` (planos). Ninguna fila preexistente se modificó ni se borró.

---

## 5. Paso 4 del orden acordado: qué usaba el modo prueba de la v3

**Ya estaba muerto antes de tocar nada.** Última escritura de `test.run_stats`: **03/09**, hace
12 días. `test.clippings`, `test.notes`, `test.notas_descartadas`, `test.notas_historico_url` y
`test.reportes` están en cero.

**Mecanismo:** los cuatro workflows v3 tienen un trigger manual `▶ Click acá para TEST` que
setea `modo=test`, y los nodos HTTP resuelven el schema con
`Accept-Profile: {{ $('GSID').first().json.schema_target }}` — `public` en prod, `test` en prueba.
Es manual, no programado.

**No se rompió.** `public.import_clipping` es ejecutable **solo por `service_role`**
(`anon`=false, `authenticated`=false), y el camino de producción la llama todas las mañanas y
funcionó hoy → **la credencial `Ketchum - supabase` de los workflows v3 es la service_role**.
`service_role` conservó `USAGE` sobre `test` y `EXECUTE` sobre sus funciones, así que el modo
prueba de la v3 sigue operativo.

Por lo tanto el paso 5 del orden acordado (*"si alguno se rompe, se arregla con RPC controlada o
service role"*) **no tiene trabajo pendiente**: ya usa service role.

---

## 6. Hallazgo nuevo: `[W0.15]` confirmado, y es una segunda exposición

Al verificar lo anterior quedó confirmado lo que el relevamiento había dejado como "pendiente de
reconfirmar". **Once funciones v4 en `public` son `SECURITY DEFINER`, ejecutables por `anon`, y
ninguna valida `has_client_access`:**

`armar_clipping` · `auditar_clipping` · `decidir_nivel` · `v4_abrir_run` (×2 firmas) ·
`v4_cerrar_run` · `v4_materializar_candidatas` · `v4_tomar_pagina` · `v4_terminar_pagina` ·
`v4_candidatas_del_lote` · `v4_evaluar_candidatas`

`public` **sí está expuesto** —es el schema normal de la API—, así que esto es alcanzable con la
misma anon key del bundle. Permite leer el clipping armado de cualquier cliente pasando otro
`client_id`, y las que abren/cierran corridas y toman páginas **mutan estado del pipeline**.

Cerrarlo es el mismo movimiento que `w016b`, y tiene el mismo bloqueante: **si la credencial
`Ketchum - Supabase` de la instancia `ketchum-n8n` (id `UnEitw6U4SIHjC6X`) fuera la anon key,
revocar `EXECUTE` corta el armado v4.** A diferencia de los workflows v3, acá no hay ninguna
función service_role-only en el camino que permita inferirlo: todas las que llama son
anon-ejecutables. **Hay que mirar el JWT de esa credencial en la UI de n8n** (claim `role`).

---

## 7. Estado del Paso 1

| Condición de "no seguir" del runbook | Estado |
|---|---|
| Alguna tabla v4 visible por REST sin RLS/policy | ✅ ninguna: las 32 con RLS + `force`, y el schema sin `USAGE` para `anon` |
| Alguna RPC v4 ejecutable por `anon` | ⛔ **11 en `public`** — §6. No son del schema `test`, pero la condición aplica |
| Una prueba de permisos puede leer otro cliente | ⛔ `armar_clipping(client_id)` lo permite — §6 |

**Paso 1 cerrado para el schema `test`. No habilita el Paso 2 todavía:** las dos condiciones de
§6 son bloqueantes del propio runbook y se resuelven con `w016b` + un `revoke` equivalente sobre
las 11 funciones de `public`, que necesita confirmar el rol de la credencial de n8n.

---

## 8. `[W0.16b]` + `[W0.15]` — aplicado el 15/09 14:30 ART

`supabase/migrations/20260915181000_w016b_cerrar_v4_test_rpc.sql`

### 8.1 Cómo se resolvió el bloqueante sin leer el secreto

La duda era si la credencial `Ketchum - Supabase` (`UnEitw6U4SIHjC6X`) era la anon key: en ese
caso, revocar `EXECUTE` cortaba el armado v4. El API de n8n no devuelve el secreto. Se probó por
evidencia:

1. El nodo `Escribir fetch_log (bulk)` del recolector hace **POST directo** a `/rest/v1/fetch_log`
   con esa credencial — no es una RPC `SECURITY DEFINER`.
2. `public.fetch_log` tiene RLS activa con **una sola policy: `is_staff()`**. Un request con la
   anon key no la satisface: no hay `auth.uid()`.
3. `fetch_log` recibió **7.698 filas el 15/09**, la última a las 14:17 ART.

Solo un rol con `BYPASSRLS` pudo escribir esas filas. `anon` no lo tiene; `service_role` sí.
**La credencial es service_role.**

### 8.2 Alcance real

El patrón alcanzó **39 funciones**, no 20: `v4\_%` incluye también los helpers
(`v4_hoy`, `v4_keyword_norm`, `v4_email_tier_norm`, `v4_corte_cliente_art`, …), que tampoco
tienen por qué ser invocables desde el navegador.

| | anon | authenticated | service_role |
|---|---:|---:|---:|
| Funciones alcanzadas | **0** | **0** | **39 / 39** |

### 8.3 Verificación con la anon key real

| RPC | Antes | Después |
|---|---|---|
| `armar_clipping` (client_id de otro cliente) | devolvía el clipping | **401** `42501 permission denied for function` |
| `auditar_clipping` | permitido | **401** `42501` |
| `v4_abrir_run` | permitido, **mutaba estado** | **401** `42501` |
| `v4_tomar_pagina` | permitido, **mutaba estado** | **401** `42501` |
| `v4_test_armar_clipping` | permitido | **401** `42501` |
| `get_actividad_resumen` *(control: la usa la webapp)* | 400 | **400** — sigue alcanzable |

### 8.4 Hallazgo lateral: `v4_abrir_run` tiene dos sobrecargas

El primer intento contra `v4_abrir_run` con 4 argumentos devolvió **`PGRST203`** (HTTP 300):
PostgREST no puede resolver entre `v4_abrir_run(uuid,text,date,text)` y
`v4_abrir_run(uuid,text,date,text,boolean)` y falla **antes** de evaluar permisos.

No es un problema hoy —`wf/armado-cliente` manda `p_rehacer` en modo prod, así que resuelve la
firma de 5— pero es una trampa: cualquier llamador que omita `p_rehacer` recibe un 300 que no
dice "falta un parámetro". **Conviene borrar la firma vieja de 4 argumentos.** Ticket aparte.

### 8.5 Lo que falta verificar

El pipeline no volvió a correr desde la migración. La prueba real es el **próximo barrido
(~17:00 ART)**: `fetch_log` tiene que seguir sumando filas. Si no suma, el DOWN del archivo
revierte en una corrida.

### 8.6 Estado del Paso 1 — ahora sí cerrado

| Condición de "no seguir" del runbook | Estado |
|---|---|
| Alguna tabla v4 visible por REST sin RLS/policy | ✅ ninguna |
| Alguna RPC v4 ejecutable por `anon` | ✅ **0 de 39** |
| Una prueba de permisos puede leer otro cliente | ✅ `armar_clipping` denegada con la anon key |

**Paso 1 cerrado. Habilita el Paso 2 (`[W0.17]`).**

> Pendiente que NO bloquea el Paso 2: ninguna de las 39 valida `has_client_access` por dentro.
> Hoy no importa porque solo `service_role` las ejecuta, pero **el Paso 5 del runbook expone la
> herramienta al plano `test`**, y ahí la app va a llamar con sesión de usuario. Antes de ese
> paso, las RPC que la app use tienen que validar acceso por cliente, no alcanzar con el grant.
