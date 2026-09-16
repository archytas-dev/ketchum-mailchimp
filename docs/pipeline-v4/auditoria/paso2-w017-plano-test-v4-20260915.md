# Paso 2 · `[W0.17]` — Plano de entrega `test.*_v4`

Ejecutado 2026-09-15. Runbook: [`roadmap-webapp-v4.md` §3.6, Paso 2](../roadmap-webapp-v4.md).
Migración: `supabase/migrations/20260915190000_w017_plano_entrega_test_v4.sql`.

---

## 1. Qué se creó

Ocho tablas en `test`, todas con RLS activada **y forzada**, una policy cada una, `authenticated`
con acceso y `anon` sin nada:

| Tabla | RLS | `force` | Policies | `authenticated` | `anon` |
|---|:--:|:--:|:--:|:--:|:--:|
| `clippings_v4` | ✅ | ✅ | 1 | ✅ | ❌ |
| `notes_v4` | ✅ | ✅ | 1 | ✅ | ❌ |
| `activity_v4` | ✅ | ✅ | 1 | ✅ | ❌ |
| `exports_v4` | ✅ | ✅ | 1 | ✅ | ❌ |
| `summaries_v4` | ✅ | ✅ | 1 | ✅ | ❌ |
| `user_clipping_state_v4` | ✅ | ✅ | 1 | ✅ | ❌ |
| `notes_precarga_v4` | ✅ | ✅ | 1 | ✅ | ❌ |
| `reportes_v4` | ✅ | ✅ | 1 | ✅ | ❌ |

---

## 2. Tres desvíos deliberados respecto del espejo literal de la v3

### 2.1 `notes_v4.orden` es `not null` **sin default**, con `check (orden >= 1)`

`public.notes.orden` es `not null default 0`. Ese default es la causa directa de uno de los tres
riesgos silenciosos de §2.1 del roadmap: si el payload omite `orden`, las 40 notas quedan en 0 y
el orden pasa a decidirlo Postgres — distinto entre recargas, y el mail deja de coincidir con la
plataforma, **sin ningún error**.

En el plano v4, un importador incompleto revienta en el `insert`. Verificado (§4).

**No se agregó `unique (clipping_id, orden)`.** Garantizaría que el orden es total de verdad,
pero el editor reordena con un swap de dos filas y eso viola la restricción a mitad de
transacción salvo haciéndola `deferrable`. Es complejidad y riesgo a cambio de una garantía que
el importador ya puede dar solo.

### 2.2 Ninguna FK de contenido cruza planos

Verificado por consulta: las únicas FKs que salen de `test` apuntan a `public.clients` y
`auth.users` — las dos entidades compartidas de sólo lectura que el runbook permite.

| Tabla | FK | Apunta a |
|---|---|---|
| `clippings_v4` · `notes_precarga_v4` · `reportes_v4` | `client_id` | `public.clients` |
| `activity_v4` · `exports_v4` · `reportes_v4` · `user_clipping_state_v4` | `user_id` | `auth.users` |

**Cero FKs hacia `public.clippings` o `public.notes`.** El resto son internas al plano
(`notes_v4.clipping_id → test.clippings_v4`, etc.).

### 2.3 Estas tablas quedan FUERA de la purga de 48 h

`v4_purgar_datos_operativos()` borra `test.notes`, `test.clippings` y `test.reportes` a las 48
horas. **Los espejos v4 no se agregaron ahí, y no deben agregarse:** son lo que revisa el equipo,
no telemetría. Está escrito en el encabezado de la migración para que nadie lo sume por inercia.

---

## 3. Columnas v4 desde el día uno

Sin esto habría que migrar el plano apenas se conecte el importador.

- **`clippings_v4`**: `nivel_salida` (con `check between 0 and 3`), `nivel_motivo`,
  `pipeline_version` (default `'v4'`), `run_id`.
- **`notes_v4`**: `candidata_id`, `dominio`, `fecha_confiable`, `confianza`, `forzada`,
  `motivo_forzada`, `tier`, `alcance`.

---

## 4. Verificación

### 4.1 Fixture mínima, con rollback

Se insertó un clipping + 2 notas (una con `forzada=true` y `motivo_forzada`, otra con
`confianza=0.91`), se probaron las dos guardas del desvío 2.1, y se revirtió todo con una
excepción final:

| Caso | Resultado |
|---|---|
| `insert` de clipping + 2 notas con `orden` 1 y 2 | ✅ aceptado |
| `insert` de nota con `orden = 0` | ✅ **rechazado** (`check_violation`) |
| `insert` de nota sin `orden` | ✅ **rechazado** (`not_null_violation`) |

### 4.2 El plano quedó vacío

`clippings_v4`, `notes_v4`, `activity_v4`, `exports_v4` = **0 filas**. El rollback funcionó.

### 4.3 La v3 no se movió

Hash acotado al corte del baseline, re-ejecutado después de la migración:

| Tabla | Filas | Hash | vs. baseline |
|---|---:|---|---|
| `clippings` | 306 | `90db83680312f9510141ebc384cff2f3` | ✅ idéntico |
| `notes` | 13288 | `0810be0fbe927862f1fe59774b8b1f8c` | ✅ idéntico |
| `activity` | 5419 | `178b2ad924449c542ad690b81b182904` | ✅ idéntico |
| `reportes` | 608 | `0d8b377a53a43a1de1ec6bc0e2e3c13b` | ✅ idéntico |

---

## 5. Lo que NO se hizo, y hay que tener presente

- **El comparador de paridad del Paso 7 todavía no existe.** El runbook (Paso 2, punto 5) pide un
  script que liste columnas, índices, FK, RLS, policies y grants, para comparar `test.*_v4`
  contra `public.*_v4` al promover. Las consultas de verificación de este documento son la base,
  pero falta empaquetarlas. Va con `[W0.21]`.
- **Las policies no se probaron con usuarios reales.** La fixture corrió como `postgres`, que
  tiene `BYPASSRLS`, así que validó el esquema y las guardas, **no la RLS**. La prueba de los
  cuatro casos (anónimo / autenticado sin cliente / cliente propio / staff) necesita sesiones
  reales y va con el Paso 5, o antes si se quiere adelantar.
- **El aislamiento descansa en dos funciones, no en el schema.** Las policies llaman a
  `public.is_staff()` y `public.has_client_access()`. Un agujero en cualquiera de las dos lo
  hereda todo el plano v4. Revisarlas antes del Paso 5.

---

## 6. Estado del Paso 2

| Condición de "no seguir" del runbook | Estado |
|---|---|
| La nueva tabla comparte una FK de contenido con v3 | ✅ ninguna — §2.2 |
| La purga de 48 h borra clippings de revisión | ✅ no: quedaron fuera — §2.3 |
| El navegador escribe tablas fuera de `test.*_v4` | ✅ `anon` sin acceso; `authenticated` sólo estas 8 |

**Paso 2 cerrado. Habilita el Paso 3 (`[W0.18]`: `import_clipping_v4` + fixture canónica).**
