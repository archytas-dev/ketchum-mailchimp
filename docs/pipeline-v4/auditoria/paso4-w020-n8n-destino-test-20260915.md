# Paso 4 · `[W0.20]` — n8n guarda en el plano v4, y el mail lee lo guardado

Ejecutado 2026-09-15. Runbook: [`roadmap-webapp-v4.md` §3.6, Paso 4](../roadmap-webapp-v4.md).
**Primera vez en toda la sesión que se toca n8n**, con autorización explícita.

Migraciones: `20260915210000_w020_clipping_v4_json.sql` · `20260915220000_w020_guardar_clipping_v4_test.sql`
Workflow: `v4 · clipping · armado-cliente` (`ORrmePsGxJJxISTo`), 46 → **47 nodos**.

---

## 1. Qué cerró esto

La divergencia de §2.2 del roadmap. Hasta hoy el mail de prueba se armaba llamando a
`v4_test_armar_clipping()` **directo**, mientras la plataforma iba a leer lo que guardara
`import_clipping_v4()`. Dos caminos con dedups distintos: una nota que el juez aprobó podía
salir en el mail y no aparecer en la plataforma.

La regla del pipeline es *"primero se guarda, después se manda leyendo lo guardado"*, y el
workflow no la cumplía. Ahora sí.

**Esto resuelve de hecho `[W0.7]`** (la decisión abierta sobre de dónde se arma el mail), en la
dirección que el roadmap del pipeline ya mandaba.

---

## 2. El cambio en n8n

### Antes
```
¿enviar email de prueba?
  └─> Armar clipping para email de prueba   → rpc/v4_test_armar_clipping
        └─> Leer tiers para email → Preparar email v3 → Enviar email v3
```

### Ahora
```
¿enviar email de prueba?
  └─> Guardar clipping v4 (test)   [NUEVO]  → rpc/v4_test_guardar_clipping
        └─> Armar clipping para email de prueba  → rpc/clipping_v4_json  [CAMBIADO]
              └─> Leer tiers para email → Preparar email v3 → Enviar email v3
```

### Por qué el nodo cambiado conserva su nombre

El Code node que construye el HTML referencia por nombre al nodo que le da el JSON, y tiene los
templates de render adentro: es grande y frágil. **No se tocó.** El nodo `Armar clipping para
email de prueba` mantiene su nombre y su forma de salida —`clipping_v4_json()` devuelve las
mismas claves que `armar_clipping()`— y sólo cambia de dónde lee.

### El nodo nuevo falla ruidosamente, a propósito

`Guardar clipping v4 (test)` **no** tiene `neverError`. Si el guardado falla, corta la rama y
**no sale mail de prueba**. La primera versión sí lo tenía, y con eso un guardado fallido dejaba
`clipping_id` indefinido y el mail se habría armado igual, con basura — justo cuando se lo está
usando para comparar contra la v3. Un mail de prueba que no sale es un problema visible; uno
armado con datos rotos, no.

---

## 3. Verificación con datos reales del día

No con la fixture: con las corridas test que el cron ya había dejado.

| Cliente | run | notas guardadas | orden | nivel |
|---|---|---:|---|---|
| BMS | `09745593…` | **91** | 1..91, sin huecos ni repetidos | 0 · "completo" |
| Booking | `06c55056…` | **112** | 1..112, sin huecos ni repetidos | — |

Lectura de vuelta con `clipping_v4_json()` sobre BMS: 7 secciones en el orden correcto
(`Noticias del Sector`, `Competencia`, `Áreas Terapéuticas`, `Onco Hematología`, `Cardiología`,
`Psoriasis`, `Trasplantes`), sin fechas nulas, fechas entre el 14 y el 15/09.

**Reimportar la misma corrida** devuelve el mismo `clipping_id` y las mismas 91 notas.

### La v3 no se movió

Los cinco hashes acotados al corte del baseline — `clippings`, `notes`, `notes_precarga`,
`activity`, `reportes` — **idénticos** después de todo lo anterior.

---

## 4. Dos cosas que aparecieron

### 4.1 El nivel de salida no viajaba

`v4_test_armar_clipping()` no devuelve `nivel_salida` ni `nivel_motivo`: los produce
`decidir_nivel()`. La primera versión guardaba el clipping con `nivel_salida` en NULL, y `[W1.7]`
—la franja de nivel en `/hoy`— se habría quedado sin dato. Corregido tomándolos de
`test.v4_pipeline_runs`, que ya los tiene escritos.

### 4.2 El cruce de tiers, medido sobre datos reales

De las **91 notas de BMS, 75 quedaron sin `ad_value`** (82 %). Es el hallazgo 3 de §1 del
roadmap visto desde el otro lado: el dato existe en `tiers` y no cruza. Es la confirmación más
directa que tenemos de que `[W5.11]` —medio día de trabajo, independiente de la v4— es lo que
más rinde de todo lo que queda.

---

## 5. Lo que NO se hizo

- **No se disparó ninguna corrida ni se mandó ningún mail.** El nodo de envío no se tocó ni se
  habilitó. La prueba de punta a punta se hizo llamando las funciones SQL directamente.
- **El cron de mañana es la prueba real.** `wf/armado-cliente` está activo con crons 06:45–07:30
  ART en `modo=test`. Mañana va a pasar por el camino nuevo. Si `Guardar clipping v4 (test)`
  falla, no sale mail de prueba y queda visible en las ejecuciones.
- **`p_destino` sigue aceptando sólo `'test'`.** `public_v4` es del Paso 7.

---

## 6. Estado del Paso 4

| Condición de "no seguir" del runbook | Estado |
|---|---|
| El workflow recibe `modo=prod` | ✅ la rama entera cuelga de `¿enviar email de prueba?`, que exige `modo = 'test'` |
| Un destinatario no interno | ✅ el nodo de envío no se tocó; sigue como estaba |
| Una diferencia entre las notas guardadas y las del mail sin motivo explicado | ✅ ya no puede haberla: el mail **se arma desde lo guardado** |

**Paso 4 cerrado. Habilita el Paso 5 (`[W0.19]`: adaptador de plano de datos en Next.js).**

> Antes del Paso 5, el pendiente que viene arrastrado del Paso 1: **ninguna de las funciones v4
> valida `has_client_access` por dentro.** Hoy no importa porque sólo `service_role` las ejecuta,
> pero el Paso 5 expone la herramienta al plano `test` con sesión de usuario real.
