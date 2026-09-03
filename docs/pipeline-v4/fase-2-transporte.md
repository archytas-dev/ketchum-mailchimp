# Fase 2 · Transporte y cobertura

Instancia: `ketchum-n8n`. Rama: `feat/pipeline-v4`.

## Estado

| Pieza | Estado |
|---|---|
| Credencial `Ketchum — Fetch Proxy (AWS/Supabase)` (`LLdAbQUu6q9ChKPG`) | **Creada y probada** — `httpHeaderAuth`, `Authorization: Bearer <anon del proyecto de prueba tufgbajqgjkwqwskkcam>` |
| Credencial `Ketchum — Fetch Proxy (Cloudflare)` (`odT5yjmKpIORGZjK`) | **Cargada y probada** — `X-Api-Key` real puesta el 03/09 |
| `v4 · sub · fetch-source` (`UUIlvhTv3Rjy9YEP`) | **Construido y probado end-to-end** (03/09). Activo (publicado, inerte). |
| `v4 · sub · fetch-escalera` (`TyXVALaeUzfPlgv8`) | **Construido y probado** (03/09) — la escalera directo→cloudflare→aws. Activo (inerte). |
| `v4 · medición · cobertura` (`XpeIOEJg92H1hrrJ`) | **Construido, validado. INACTIVO.** Manual Trigger. Falta dispararlo (~1–2 h). Instrucciones: `workflows/README.md`. |
| `wf/descubridor` (A0) | Pendiente — después de ver el resultado de la medición |
| Credencial Bright Data | Pendiente — nodo deshabilitado en `sub/fetch-source` |

> **Dato del smoke-test:** desde la IP de n8n de hoy, Clarín y La Nación entran por **`directo`** (10 y 88 items). El prototipo (02/09) decía que bloqueaban a n8n — o se levantó, o cambió la IP de egress. La medición dirá cuánto pesa `directo` de verdad; el problema de transporte puede ser más chico de lo estimado.

## Probado end-to-end (03/09)

Con un workflow-runner temporal (`webhook → sub/fetch-source`), ya borrado.

| Caso | Resultado |
|---|---|
| directo + Google News RSS | `ok` · 117 items · 117 con fecha |
| directo + `clarin.com/rss/politica/` | `ok` · 10 · 10 (desde la IP de n8n, hoy Clarín directo anda) |
| cloudflare + `clarin.com/rss/politica/` | `ok` · 10 · 10 |
| aws + `clarin.com/rss/politica/` | `ok` · 10 · 10 |
| directo + URL de sección inexistente | `no_existe` (404) |
| Cloudflare sin key (curl) | `401` — está cerrado |
| Cloudflare + Infobae (curl) | `bloqueado` (403) — esperado, entra por AWS |

`fetch_log` recibió una fila por cada intento con el diagnóstico y los conteos correctos. Después se limpió.

### 2 bugs encontrados y arreglados al probar

1. **`fetch_log.diagnostico` CHECK** no incluía el vocabulario de los proxies (`no_es_feed`, `caido`, `rate_limit`). → migración `20260903182919_pipeline_v4_fetch_log_diagnostico_alinear_proxy`.
2. **`HTTP directo` con `responseFormat: text` + `fullResponse`** deja el body crudo en `.data`, no en `.body`. El nodo `Normalizar` leía `.body` → siempre `no_es_feed`. → `HTTP directo` con `responseFormat: text` explícito + `Normalizar` lee `inp.data ?? inp.body`.
| `wf/descubridor` (A0) | Pendiente |
| Workflow de medición aislado | Pendiente — necesita OK explícito (pega a ~1.776 dominios) |
| Credencial Bright Data | Pendiente — nodo deshabilitado en `sub/fetch-source` |

## `sub/fetch-source` — el bloque reutilizable

**Contrato de entrada:** `{ fuente_id, dominio_norm, url, formato, transporte, pasada }`
**`transporte` es UNO solo** (`directo` | `cloudflare` | `aws` | `brightdata`). Probar el siguiente escalón es trabajo del orquestador, no de este subwf — así cada intento es una ejecución separada y trackeable.

**Contrato de salida:** `{ fuente_id, dominio_norm, formato, transporte, diagnostico, http_status, items[], articulos, con_fecha, ms }`

**Nodos:** `Entrada` → `Switch transporte` → (`HTTP directo` | `HTTP Cloudflare` | `HTTP AWS` | `HTTP Bright Data`) → `Normalizar → contrato` → `Escribir fetch_log` → `Salida`.

- Los proxies devuelven JSON ya parseado (`{ok, diagnostico, formato, upstream_status, total, con_fecha, ms, items[]}`). El `directo` devuelve XML crudo → `Normalizar` lo parsea con regex (RSS/Atom/sitemap; v1, se endurece después).
- `diagnostico` posible: `ok` · `bloqueado` · `sin_items` · `no_es_feed` · `no_existe` · `caido` · `timeout` · `rate_limit`.
- `neverError: true` en los HTTP → un 403/timeout no corta el flujo, se diagnostica.
- Escribe una fila en `fetch_log` por cada intento, ande o no. `onError: continue` en ese nodo: si el log falla, igual se devuelve el resultado.

## La escalera (la arma el orquestador, no este subwf)

```
formato rss|wordpress|sitemap        formato html
  1. directo                           1. directo
  2. cloudflare                        2. jina        (pendiente)
  3. aws                               3. brightdata  (pendiente)
  4. brightdata
```

El orquestador llama a `sub/fetch-source` con `transporte=directo`. Si vuelve con
`articulos=0` y `diagnostico in (bloqueado, caido, timeout)`, lo vuelve a llamar con el
siguiente escalón. Corta en el primero con `articulos > 0`. Nunca escala con `sin_items`.
Guarda el `transporte` que funcionó en `medios_estrategia` — sin eso, cada corrida re-prueba todo.

## Para destrabar

1. **`X-Api-Key` de Cloudflare** → cargarla en la credencial `odT5yjmKpIORGZjK` (hoy tiene un placeholder). La tiene el dev que armó el proxy.
2. **Dónde vive la Edge Function AWS en producción** — hoy está en el proyecto de prueba `tufgbajqgjkwqwskkcam`. El doc de arquitectura recomienda un proyecto Supabase aparte compartido por los cuatro clientes.
3. **OK para el workflow de medición** — recorre los ~1.776 dominios una noche por la escalera, sin mandar mails ni escribir tablas de cliente. Es el número que decide si la v4 vale la pena.

## Primer test cuando se retome

`sub/fetch-source` con `{ url: "<un feed RSS conocido>", transporte: "directo", formato: "rss" }` → debe devolver `diagnostico: "ok"` con items y una fila en `fetch_log`. Eso valida el parseo y la escritura sin depender de ningún proxy.
