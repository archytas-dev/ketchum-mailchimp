# Workflows v4 · `ketchum-n8n`

Respaldo de referencia. La **fuente de verdad es la instancia** `ketchum-n8n`
(`n8n-ketchum.archytas.io`, project `lZwDOgXzFudxU5oC`).

**Todos viven en `KETCHUM/V4`** (movidos el 08/09; antes estaban sueltos en la raíz del
proyecto). Los archivados están en `KETCHUM/ARCHIVO`.

**Los nombres dicen cuándo corre cada uno** (renombrados el 08/09): `v4 · <etapa> · <nombre>`,
con etapa `recolección`, `clipping`, `operación`, `mantenimiento`, `pieza` o `prueba`. Ordenan
solos alfabéticamente y quedan agrupados por etapa sin numerar nada — numerar obliga a renumerar
todo cuando se inserta un paso en el medio.

**Ninguno de estos workflows manda mensajes.** Todos los `httpRequest` van a Supabase o a los proxies de transporte. Cero Slack, cero mail. `sub/slack-notify` y `sub/send-email` existen pero con **el nodo de salida deshabilitado**, y los dos nodos que los llaman —en `wf/error-handler` y `wf/salud`— **también nacen deshabilitados**. Encenderlos son cuatro decisiones explícitas, no una.

## Las piezas (`pieza ·`) — no se disparan solas, las llama otro

| Workflow | ID | Rol | Estado | Export |
|---|---|---|---|---|
| `v4 · pieza · fetch-source` | `UUIlvhTv3Rjy9YEP` | 1 fuente, 1 transporte → `{diagnostico, items[]}` de un **feed** + escribe `fetch_log` | activo (inerte) | ✅ |
| `v4 · pieza · fetch-escalera` | `TyXVALaeUzfPlgv8` | la escalera directo→cloudflare→aws sobre una fuente. Corta en el primero con items | activo (inerte) | — |
| `v4 · pieza · llm-call` | `8xgMfLdQLuwkpVgr` | llamada al modelo + retry + tope de tokens + registro de costo. Lee el prompt vigente de `client_prompts` | activo (inerte) · **07/09** | — |
| `v4 · pieza · slack-notify` | `Gf7f1x1qa5l6ssPe` | aviso consolidado. **El nodo de Slack nace DESHABILITADO** | activo (inerte) · **07/09** | — |
| `v4 · pieza · send-email` | `4K8k0C1ptXdSiSdB` | envio con dos guardas. **El nodo de Gmail nace DESHABILITADO** | activo (inerte) · **07/09** | — |
| `v4 · pieza · agent-A1 completador` | `E5JLokzkBxeCyLzv` | arregla titulos y copetes rotos; abre la nota solo si quedo incompleta | activo (inerte) · **07/09** | — |
| `v4 · pieza · open-article` | `mnofS4TurFRTVRsh` | abre UNA nota y saca titulo, copete y la fecha que el sitio declare | activo (inerte) · **07/09** | — |
| `v4 · pieza · agent-A2 juez` | `9pwrSH2KdpGhbXjS` | por lote: decide si la nota entra y en que seccion, con confianza. Aplica en codigo las restricciones que el prompt no puede garantizar | activo (inerte) · **07/09** | — |
| `v4 · pieza · fetch-page` | `kwyBxom1AVrwQJ8m` | 1 URL, 1 transporte → **el HTML crudo**. Para las fuentes sin feed y, en la Fase 5, para que A1 abra una nota | activo (inerte) · **07/09** | ✅ |

> **`sub/fetch-source` tiene una mina:** su normalizador usa `$('Entrada').first()`. Hoy no duele porque la escalera lo llama de a uno, pero si alguna vez se lo llama con N items, los N resultados se van a creer el primero. `fetch-page` ya tuvo ese bug y se arregló con `$itemIndex`.

## Los que corren (`recolección · clipping · operación · mantenimiento`)

| Workflow | ID | Rol | Estado |
|---|---|---|---|
| `v4 · recolección · recolector feeds` | `tzcHSIUdMGXVRFIo` | una tanda de fuentes → `fetch_log` + `candidatas_raw` (dedup en la base) | activo · webhook `v4-recolector` |
| `v4 · recolección · barrido feeds` | `wEuM4z6hIuLGwQFF` | drena el barrido entero iterando tandas | activo · **9 cron ART desde el 07/09** + webhook `v4-barrido` |
| `v4 · mantenimiento · re-verificar transporte` | `y5UXitrQdQ5UkKL4` | reprueba el transporte de las que empezaron a fallar | activo · **cron 07:15 ART desde el 07/09** |
| `v4 · mantenimiento · descubridor (A0)` | `nvShglwLuHqgF5cp` | busca feeds que no sabíamos que existían | **inactivo** — se dispara a mano |
| `v4 · mantenimiento · medir-html` | `wqHvLCVH4mcTWdvl` | sube la escalera sobre las 178 sin feed y guarda el transporte ganador | activo · webhook `v4-medir-html` · **07/09** |
| `v4 · clipping · armado-cliente` | `ORrmePsGxJJxISTo` | el clipping de un cliente de punta a punta: candidatas -> A1 -> A2 -> veredictos -> armar -> auditar -> nivel | activo · webhook `v4-armado`, **sin cron hasta el golden**. Idempotente: abre la corrida en `pipeline_runs` antes de gastar un token · **07/09** |
| `v4 · recolección · recolector html` | `p6MFCVE8Ggx65Npq` | espejo del recolector para las sin feed: extrae las notas del HTML de la home. Lee `v4_recoleccion_html_pendientes` | activo · webhook `v4-recolector-html` · **07/09** |
| `v4 · operación · error-handler` | `X48CQZrLOlJXOiwb` | atrapa el fallo de cualquier `wf/*` y lo escribe en `v4_errores`. El nodo que avisa está **deshabilitado** | **activo (tiene que estarlo: inactivo no se dispara)** · **07/09** |
| `v4 · operación · salud` | `1DH5Sw3bcul166SJ` | parte diario: pool vs. el mismo día de la semana, cobertura, mudas, errores y el corte por cliente | activo · **cron 09:00 ART** + webhook `v4-salud` · **07/09** |
| `v4 · recolección · barrido html` | `Zm8OhzNmu0uLs2JA` | driver del anterior: lo drena por tandas de 10 | activo · **9 cron ART, 15 min despues que el de feeds** + webhook `v4-barrido-html` · **07/09** |

## Archivadas (Fase 2, ya cumplieron) — 08/09

Las cuatro de medición se desactivaron y se movieron a la carpeta `KETCHUM/ARCHIVO`, con prefijo
`ZZ · archivo ·` para que caigan al fondo de la lista. **No se borraron:** el SQL del resumen está
en este README, pero los workflows no tienen export y no se recuperan.

`ZZ · archivo · v4 medición cobertura` (`lVRHLZaL5VCmfWFK`) · `… escalera pendiente` (`2yemtvcIABA0KB34`) · `… brightdata` (`KsM1FuFk33LQd75S`) · `… cobertura ROTA` (`XpeIOEJg92H1hrrJ`).

> **El archivado real de n8n no está expuesto por la API pública**, así que "archivar" acá es
> desactivar + mover a carpeta + prefijo. El efecto es el mismo: fuera de la lista de trabajo,
> sin webhooks vivos y recuperable.

## Sigue viva para probar

`v4 · prueba · disparador de llm-call` (`URVXe92t5up6P7uR`): 4 webhooks para pegarle a un prompt
suelto sin correr el pipeline entero. Es el harness, no se archiva.

## Credenciales usadas

| Credencial | ID | Para |
|---|---|---|
| `Ketchum - Supabase` | `UnEitw6U4SIHjC6X` | escribir `fetch_log`, leer `medios_fuentes` |
| `Ketchum — Fetch Proxy (Cloudflare)` | `odT5yjmKpIORGZjK` | `HTTP Cloudflare` en `sub/fetch-source` |
| `Ketchum — Fetch Proxy (AWS/Supabase)` | `LLdAbQUu6q9ChKPG` | `HTTP AWS` en `sub/fetch-source` |

## Cómo correr la medición

1. Abrir `ZZ · archivo · v4 medición cobertura` en `ketchum-n8n`.
2. Verificar que `v4 · pieza · fetch-source` y `v4 · pieza · fetch-escalera` están **activos** (publicados) — si no, activarlos.
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
