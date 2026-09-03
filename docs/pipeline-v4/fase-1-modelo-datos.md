# Fase 1 · Modelo de datos v4

Migraciones nuevas en `supabase/migrations/`, sobre la rama `feat/pipeline-v4`.
**Aplicadas a producción el 03/09/2026** (proyecto `banlcbewinpjtudzdzhm`). Decisión del 03/09: no hay revisión por-migración; la revisión de un segundo es al final, con todo armado y orquestado. Todo lo aplicado es aditivo y reversible.

## Qué se extiende y qué es nuevo

La Fase 0 (agosto) ya construyó parte del modelo. La Fase 1 **extiende** lo que ya está y crea solo lo que falta — no tablas paralelas que dupliquen.

| Doc pide | Ya existía (Fase 0) | Decisión Fase 1 |
|---|---|---|
| `descartes` (nota que no entró + regla + valor) | `notas_descartadas` | **Extender** (+`regla_id`, `valor_que_matcheo`, `etapa`, `explicacion`, `recuperable`, `pipeline_run_id`) |
| telemetría por corrida | `run_stats` | **Se queda.** El detalle por etapa va en `stage_events` nuevo |
| `reglas_filtro` | `medios_bloqueados` / `_global` (solo blocklist de dominio) | **Nueva** — modelo general (patrón título/URL, tld, idioma, antigüedad) con peso y contadores |
| secciones del cliente | `secciones` (con `alias[]`, `es_exclusiva`, `orden`) | **Se queda como está** |
| `client_prompts` | — | **Nueva** |
| `medios_catalogo/_fuentes/_suscripcion` | `medios` (con `client_id`) | **Nuevas** al lado. `medios` sigue vivo hasta el cutover (§10.7) |
| `tier_norm` + `tier_alias` | `norm_url`, `txt_fold` (otras) | **Nuevas**, nombres nuevos, no se toca nada v3 |

## Las migraciones (2 archivos, 8 bloques)

Se aplicaron como **una sola migración atómica** (todo o nada) más un fix. Los archivos del repo son 1:1 con lo que quedó en `supabase_migrations.schema_migrations`.

| Versión | Archivo | Qué hace |
|---|---|---|
| `20260903174914` | `pipeline_v4_fase_1_modelo_datos` | Los 8 bloques: **(1)** `medios_catalogo/_estrategia/_fuentes/_suscripcion` · **(2)** `reglas_filtro` + `client_prompts` · **(3)** `fetch_log` + `candidatas_raw` · **(4)** `notas_descartadas` +6 columnas nullable + FK `NOT VALID` · **(5)** `pipeline_runs` + `stage_events` + `log_stage()` / `set_run_outcome()` · **(6)** `tier_norm()` + `url_canonica()` + `resolver_fecha()` + `es_repetida()` + `tier_alias` · **(7)** RLS + policies + `GRANT EXECUTE` · **(8)** `CREATE SCHEMA clipping_ensayo` (cerrado a `anon`) |
| `20260903175136` | `pipeline_v4_funciones_puras_search_path` | `set search_path to 'public'` en `tier_norm` / `url_canonica` / `resolver_fecha` (advisor `function_search_path_mutable`) |

Down: `DROP` de cada tabla/función nueva + `ALTER TABLE notas_descartadas DROP COLUMN IF EXISTS …` + `DROP SCHEMA clipping_ensayo CASCADE`.

## Por qué no rompe la v3 que sale hoy

- Solo `ADD COLUMN` nullable/default en tablas vivas. Nada de `DROP`, `RENAME`, cambio de tipo.
- `log_run_stats` inserta en `notas_descartadas` **por nombre de columna** (verificado) → columna nueva = ignorada.
- Ningún RPC devuelve `SETOF <tabla>` (verificado los 6) → el nº de columnas no cambia ningún contrato.
- Ninguna función v3 se toca. Todas las nuevas tienen nombre nuevo.
- Tablas nuevas: invisibles hasta que algo las referencie.
- Precedente: Fase 0 ya hizo esto sobre las mismas tablas (`alter table run_stats add …`, etc.).

## Verificado post-aplicación

- 11 tablas nuevas, 6 columnas en `notas_descartadas`, 6 funciones, schema `clipping_ensayo` — todo presente. Las 11 tablas con RLS activado.
- `tier_norm('La Voz del Interior')` → `voz del interior`; `tier_norm('El Cronista')` → `cronista`. (Ojo Postgres: `\y` = word boundary, `\b` = backspace.)
- `url_canonica('…google.com/url?url=…x.com/nota%3Fid%3D9&utm_source=a')` → `x.com/nota?id=9` (desenvuelve el redirect, decodifica, conserva `?id=`, saca `utm_*` y fragmento).
- `resolver_fecha({feed:"2026-09-02T10:00:00Z"})` → `{fecha, origen:feed, confiable:true}`; sin fecha → `confiable=false` (nunca pone hoy).
- `get_advisors security` tras aplicar: **cero hallazgos nuevos en `public`**. Lo que aparece es preexistente: los 28 `rls_disabled_in_public` son todos del schema `test` (que la Fase 0 cierra), y el `anon_security_definer_function_executable` de `log_stage` / `set_run_outcome` / `es_repetida` es el **mismo patrón que ya tiene `log_run_stats` en prod** (funciones que n8n llama vía PostgREST y que escriben a tablas con RLS de staff — el bypass del definer es intencional). Queda para la revisión de seguridad del final decidir si n8n pasa a un rol dedicado en vez de `anon`.

## Poblado (aplicado 03/09)

`20260903180437_pipeline_v4_poblado_catalogo_desde_medios` + `20260903180520_..._saca_clientes_historicos`. Solo INSERT/DELETE en las tablas nuevas, no toca `medios`.

- **`medios_catalogo`: 1542** dominios (distinct, normalizado `lower` + sin `www.`).
- **`medios_fuentes`: 1542** — una "portada" por dominio. Formato resuelto por prioridad `rss > sitemap > jina > manual_review` para los 148 dominios con método distinto por cliente. Reparto: rss 757 · sitemap 446 · html 234 (era `jina`) · sin formato 105 (`manual_review`/null → `activa=false`).
- **`medios_estrategia`: 1437** — semilla de formato + url. `transporte='jina'` sólo para los `html`. La Fase 2 (descubridor) reescribe esto con lo que realmente funciona.
- **`medios_suscripcion`: 2102** — una fila por (cliente vivo, dominio). Se sacaron 99 filas de los 4 clientes `(histórico)`. Reparto: BMS 711 · MSD 619 · MARS 536 · Booking 236.
- **236 filas `sin-dominio:*` de `medios` NO se poblaron** — altas donde no se pudo parsear el dominio (`sin-dominio:20minutos`, `sin-dominio:0223-com-ar`…). Algunas recuperables, otras no. → ticket de limpieza aparte.
- **`medios` sigue intacto y vivo.** La v3 lo usa igual. El catálogo nuevo es una foto para construir encima; se re-sincroniza o se abandona `medios` en el cutover.

## Deferido a propósito

- **`url_canonica`**: falta el decode base64 de `news.google.com/rss/articles/CBMi…` → **Fase 4** (normalización).
- **`resolver_fecha` / `es_repetida`**: v1. Endurecido en **Fase 4** (JSON-LD real del cuerpo, `notas_historico_url` reconstruido con `url_canonica`).
- **Schema de prueba**: ~~se creó `clipping_ensayo` nuevo~~ → **revertido el 03/09** (`20260903190200_pipeline_v4_drop_clipping_ensayo`). Decisión: en vez de un schema nuevo se reusa y asegura el `test` que ya existe (la v3 lo usa en modo prueba, ya tiene 28 tablas clonadas). Asegurarlo (RLS + revocar permisos peligrosos del rol `anon`) → **Fase 0**. Sincronizarlo con la estructura actual de `public` → **Fase 3**.
- **Poblar** `medios_catalogo/_fuentes/_suscripcion` desde `medios` + comparar dominio a dominio → paso siguiente de la Fase 1, migración aparte.

## Deuda de migraciones del repo (preexistente, no de esta Fase)

`supabase migration list` muestra drift anterior a este trabajo: hay ~5 migraciones locales de agosto (`20260810150000`–`190000`) que figuran sin par remoto, y ~12 migraciones remotas (aplicadas por MCP entre el 10/08 y el 02/09: `add_notas_historico_url_dedup`, `mail_repetidas`, etc.) que no están en el repo. Por eso **`supabase db push` no es seguro hoy** — reconciliar ese drift es un ticket aparte. Las 2 migraciones de la Fase 1 se aplicaron por MCP con la versión exacta que quedó en el repo, así que esas sí están alineadas.
