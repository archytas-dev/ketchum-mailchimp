# Workflows v4 · `ketchum-n8n`

Respaldo de referencia. La **fuente de verdad es la instancia** `ketchum-n8n`
(`n8n-ketchum.archytas.io`, project `lZwDOgXzFudxU5oC`).

**Ninguno de estos workflows manda mensajes.** Todos los `httpRequest` van a Supabase o a los proxies de transporte. Cero Slack, cero mail. `sub/slack-notify` y `sub/send-email` de la Fase 6 van a nacer deshabilitados y sin conectar.

## Los ladrillos (`sub/`)

| Workflow | ID | Rol | Estado | Export |
|---|---|---|---|---|
| `v4 · sub · fetch-source` | `UUIlvhTv3Rjy9YEP` | 1 fuente, 1 transporte → `{diagnostico, items[]}` de un **feed** + escribe `fetch_log` | activo (inerte) | ✅ |
| `v4 · sub · fetch-escalera` | `TyXVALaeUzfPlgv8` | la escalera directo→cloudflare→aws sobre una fuente. Corta en el primero con items | activo (inerte) | — |
| `v4 · sub · fetch-page` | `kwyBxom1AVrwQJ8m` | 1 URL, 1 transporte → **el HTML crudo**. Para las fuentes sin feed y, en la Fase 5, para que A1 abra una nota | activo (inerte) · **07/09** | ✅ |

> **`sub/fetch-source` tiene una mina:** su normalizador usa `$('Entrada').first()`. Hoy no duele porque la escalera lo llama de a uno, pero si alguna vez se lo llama con N items, los N resultados se van a creer el primero. `fetch-page` ya tuvo ese bug y se arregló con `$itemIndex`.

## Los orquestadores (`wf/`)

| Workflow | ID | Rol | Estado |
|---|---|---|---|
| `v4 · wf · recolector (compartido)` | `tzcHSIUdMGXVRFIo` | una tanda de fuentes → `fetch_log` + `candidatas_raw` (dedup en la base) | activo · webhook `v4-recolector` |
| `v4 · wf · barrido (driver)` | `wEuM4z6hIuLGwQFF` | drena el barrido entero iterando tandas | activo · **9 cron ART desde el 07/09** + webhook `v4-barrido` |
| `v4 · wf · re-verificar estrategia` | `y5UXitrQdQ5UkKL4` | reprueba el transporte de las que empezaron a fallar | activo · **cron 07:15 ART desde el 07/09** |
| `v4 · wf · descubridor (A0)` | `nvShglwLuHqgF5cp` | busca feeds que no sabíamos que existían | **inactivo** — se dispara a mano |
| `v4 · wf · medir-html (escalera)` | `wqHvLCVH4mcTWdvl` | sube la escalera sobre las 178 sin feed y guarda el transporte ganador | activo · webhook `v4-medir-html` · **07/09** |
| `v4 · wf · recolector-html` | `p6MFCVE8Ggx65Npq` | espejo del recolector para las sin feed: extrae las notas del HTML de la home. Lee `v4_recoleccion_html_pendientes` | activo · webhook `v4-recolector-html` · **07/09** |
| `v4 · wf · barrido-html` | `Zm8OhzNmu0uLs2JA` | driver del anterior: lo drena por tandas de 10 | activo · **9 cron ART, 15 min despues que el de feeds** + webhook `v4-barrido-html` · **07/09** |

## Herramientas de un solo uso (Fase 2, ya cumplieron)

`v4 · medición · cobertura FINAL` (`lVRHLZaL5VCmfWFK`) · `v4 · medición · escalera pendiente` (`2yemtvcIABA0KB34`) · `v4 · medición · brightdata` (`KsM1FuFk33LQd75S`) · `ZZ · OBSOLETO · medición cobertura` (`XpeIOEJg92H1hrrJ`, roto, no usar).

## Credenciales usadas

| Credencial | ID | Para |
|---|---|---|
| `Ketchum - Supabase` | `UnEitw6U4SIHjC6X` | escribir `fetch_log`, leer `medios_fuentes` |
| `Ketchum — Fetch Proxy (Cloudflare)` | `odT5yjmKpIORGZjK` | `HTTP Cloudflare` en `sub/fetch-source` |
| `Ketchum — Fetch Proxy (AWS/Supabase)` | `LLdAbQUu6q9ChKPG` | `HTTP AWS` en `sub/fetch-source` |

## Cómo correr la medición

1. Abrir `v4 · medición · cobertura` en `ketchum-n8n`.
2. Verificar que `v4 · sub · fetch-source` y `v4 · sub · fetch-escalera` están **activos** (publicados) — si no, activarlos.
3. **Execute Workflow** en el nodo `▶ Disparar medición`.
4. Tarda ~1–2 h (lotes de 15, ~1.262 fuentes, hasta 3 intentos c/u).
5. Al terminar, correr el resumen (query en el nodo `Fin`):

```sql
select transporte, diagnostico, count(*)
from fetch_log where pasada='medicion' and fecha=current_date
group by 1,2 order by 1,2;

select count(distinct dominio_norm) filter (where diagnostico='ok') recuperados,
       count(distinct dominio_norm) total_probados
from fetch_log where pasada='medicion' and fecha=current_date;

-- por qué transporte entró cada dominio que entró
select coalesce(g.transporte,'ninguno') transporte_ganador, count(*) dominios
from (
  select distinct on (dominio_norm) dominio_norm, transporte
  from fetch_log where pasada='medicion' and fecha=current_date
  order by dominio_norm, (diagnostico='ok') desc, ts
) g group by 1 order by 2 desc;
```

Ese es **el número que decide si la v4 vale la pena**: cuántos dominios entran y por qué vía.
