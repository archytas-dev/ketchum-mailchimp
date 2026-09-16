# Paso 3 · `[W0.18]` — Contrato e importador únicos

Ejecutado 2026-09-15. Runbook: [`roadmap-webapp-v4.md` §3.6, Paso 3](../roadmap-webapp-v4.md).
Migración: `supabase/migrations/20260915200000_w018_import_clipping_v4.sql`
Fixture: `supabase/fixtures/clipping_v4_bms_v1.json`

---

## 1. Qué se construyó

`public.import_clipping_v4(p_clipping jsonb, p_run_id text, p_destino text default 'test')`.

Toma **la salida literal de `armar_clipping()`** —el jsonb con `secciones[].notas[]`— y la escribe
en el plano v4. Es `SECURITY DEFINER`, y su `EXECUTE` está revocado de `anon`/`authenticated`:
sólo `service_role`.

**Decisión de diseño:** el aplanado vive en SQL, no en un nodo Code de n8n. El ticket `[W0.8]`
del roadmap preveía que n8n aplanara y numerara; hacerlo acá significa que la regla existe una
sola vez y se testea con SQL, no inspeccionando un nodo.

### Los tres riesgos de §2.1, resueltos en un solo lugar

| Riesgo | Cómo se resuelve |
|---|---|
| `orden` colapsado en 0 | Se numera **global desde 1** cruzando secciones. La tabla lo exige (`not null check >= 1`), así que un payload incompleto revienta en vez de desordenar en silencio |
| `pub_date` corrido un día | `(fecha_pub at time zone 'America/Argentina/Buenos_Aires')::date` |
| Tres normalizadores de URL | Una sola: `public.url_canonica()`, la que ya usa la v4 |

---

## 2. Dos bugs que encontraron las pruebas de contrato

Ambos eran míos, en la primera versión de la función.

### 2.1 Colisión del temp table entre dos llamadas de la misma transacción

`create temp table _notas_v4 on commit drop` falla en la segunda llamada dentro de una misma
transacción — exactamente lo que hace el test de idempotencia. Corregido con un
`drop table if exists` previo.

### 2.2 Un payload **sin** la clave `secciones` pasaba el control

El control era `if jsonb_typeof(p_clipping->'secciones') <> 'array'`. Cuando la clave no existe,
`p_clipping->'secciones'` es SQL NULL, `jsonb_typeof(NULL)` es NULL, y `NULL <> 'array'` **no es
verdadero**: el `if` nunca disparaba y la función seguía de largo, creando un clipping vacío.

Corregido con `coalesce(jsonb_typeof(...), '(ausente)') <> 'array'`. La fila que se coló durante
la prueba se borró.

> Es la misma familia que el bug del `default que no era default` del roadmap del pipeline: un
> control que parece existir y no se ejecuta nunca. Lo encontró la prueba, no la lectura.

---

## 3. Dos errores míos de método, anotados para no repetirlos

### 3.1 La fixture tenía mal el caso borde

Puse la segunda nota en `2026-09-16T03:00:00+00:00` creyendo que probaba el corrimiento. En hora
argentina eso es **medianoche del 16**, o sea que `2026-09-16` era la respuesta correcta: no
probaba nada. Corregida a `2026-09-16T02:00:00+00:00` = **23:00 ART del 15**.

Demostración del mecanismo, con la zona de sesión real del proyecto (`UTC`):

| Expresión | Resultado |
|---|---|
| `'2026-09-16T02:00:00+00:00' at time zone 'America/Argentina/Buenos_Aires'` | `2026-09-15 23:00:00` |
| …`::date` (lo que hace el importador) | **`2026-09-15`** ✅ |
| `'2026-09-16T02:00:00+00:00'::date` (sin el cast) | **`2026-09-16`** ❌ |

Esa última línea es el bug que el importador evita.

### 3.2 El primer test de idempotencia no probaba nada

Puse el `import` y la verificación en la misma sentencia, con CTEs. **Todas las CTE de una
sentencia leen el mismo snapshot**, así que la CTE `despues` leyó la tabla *antes* del
re-import: dio `idempotente = true` trivialmente. Rehecho en sentencias separadas.

---

## 4. Resultados

### 4.1 Pruebas negativas — 6 de 6 rechazadas

| Caso | Resultado |
|---|---|
| `p_destino = 'public_v4'` | rechazado (`invalid_parameter_value`) |
| Payload que es un arreglo, no un objeto | rechazado |
| Payload **sin** la clave `secciones` | rechazado *(este es el bug 2.2)* |
| `secciones` presente pero no es arreglo | rechazado |
| Sin `client_id` | rechazado |
| Sin `fecha` | rechazado |

### 4.2 Import de la fixture

```
notas_n8n: 5 · notas_del_equipo: 1 · precarga_volcada: 1
descartadas_por_url_repetida: 1 · pisadas_por_el_equipo: 1
```

7 notas en el payload → 1 cae por URL canónica repetida → 1 más cae porque el equipo ya tenía esa
gacetilla precargada → 5 de n8n + 1 del equipo.

| orden | origen | título | pub_date | confianza | forzada |
|---:|---|---|---|---:|:--:|
| 1 | n8n | BMS presenta resultados de fase 3… | **2026-09-15** | 0.94 | |
| 2 | n8n | Nueva aprobacion regulatoria… | **2026-09-15** | 0.88 | |
| 3 | n8n | El mercado farmaceutico argentino… | 2026-09-15 | 0.71 | |
| 4 | n8n | Resistencia antimicrobiana… | 2026-09-15 | 0.58 | ✅ |
| 5 | n8n | Un laboratorio local anuncia inversion | `null` | 0.66 | |
| 6 | cliente | Gacetilla que el equipo ya precargo | 2026-09-15 | | |

Las filas 1 y 2 son los dos casos borde de zona horaria: sin el cast habrían quedado en el 16.
La sección `Competencia`, vacía en el payload, no generó notas. El `orden` cruza el límite entre
secciones (la 3 es la primera de "Noticias del Sector").

### 4.3 Idempotencia

Segundo import del mismo payload: mismo `clipping_id`, mismas 6 notas, `precarga_volcada: 0`
(ya estaba consumida), `precarga_pendiente: 0`.

### 4.4 `orden` es una secuencia real

`count(*) = count(distinct orden)`, `min = 1`, `max = count(*)` → **verdadero**. Sin duplicados
ni huecos, incluyendo la nota del equipo renumerada al final.

### 4.5 La v3 no se movió

Hash acotado al corte del baseline, después de todo lo anterior:
`clippings` 306, `notes` 13288, `notes_precarga` 103, `activity` 5419 — **los cuatro hashes
idénticos**. El importador no nombra una sola tabla v3.

---

## 5. Desvío del runbook, explícito

El runbook (Paso 3, punto 4) pide una prueba de contrato *"orden repetido falla"*. **Esa prueba
no puede pasar, porque en `[W0.17]` se decidió deliberadamente no agregar
`unique (clipping_id, orden)`**: el editor reordena con un swap de dos filas y eso violaría la
restricción a mitad de transacción salvo haciéndola `deferrable`.

La garantía existe igual, pero viene del importador y no de la base, y por eso se verifica de
otra forma: §4.4 comprueba que el resultado es una secuencia 1..N sin repetidos.

**Si se quiere la garantía en la base** —y hay un argumento para quererla, porque el editor
también escribe `orden` desde el navegador— el camino es
`unique (clipping_id, orden) deferrable initially deferred`. Queda como decisión abierta, no
como olvido.

---

## 6. Lo que falta del Paso 3

- **`p_destino` sólo acepta `'test'`.** Habilitar `'public_v4'` es del Paso 7, a propósito.
- **Las pruebas corrieron como `postgres`** (BYPASSRLS): validan el contrato y la lógica, **no
  las policies**. Igual que en el Paso 2.
- **El mail sigue armándose desde el JSON anterior, no desde lo guardado.** Eso es el Paso 4
  (`[W0.20]`) y depende de la decisión `[W0.7]`. Mientras no se haga, mail y plataforma pueden
  divergir — que es justo lo que este importador existe para evitar.

---

## 7. Estado del Paso 3

| Condición de "no seguir" del runbook | Estado |
|---|---|
| El mail lee el JSON previo mientras la web lee lo importado | ⚠️ **sigue así** — es el Paso 4, `[W0.20]` |
| El importador toca `public.import_clipping` o tablas v3 | ✅ no las nombra; baseline idéntico |

**Paso 3 cerrado en lo que le corresponde. Habilita el Paso 4 (`[W0.20]`)**, que es el que cierra
la divergencia entre mail y plataforma — y que requiere tocar n8n, hoy fuera de alcance sin
autorización explícita.
