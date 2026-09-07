# ketchum-mailchimp

Plataforma web del **clipping de Ketchum**. Es donde el equipo revisa, edita y exporta el
clipping antes de que salga al cliente final — el último control humano del proceso.

Los clippings los generan 4 flujos de n8n (uno por cliente: BMS, Booking, MSD, MARS) que
escriben en Supabase; esta app lee de ahí.

> **La documentación funcional vive en `archytas-docs`**, no acá:
> - [clientes/ketchum/README.md](https://github.com/archytas-dev/archytas-docs/blob/main/clientes/ketchum/README.md) — el proyecto completo
> - [clientes/ketchum/editor-web.md](https://github.com/archytas-dev/archytas-docs/blob/main/clientes/ketchum/editor-web.md) — qué hace cada pantalla y por qué
> - [clientes/ketchum/infraestructura.md](https://github.com/archytas-dev/archytas-docs/blob/main/clientes/ketchum/infraestructura.md) — dónde vive cada pieza
>
> Este README cubre solo lo técnico del repo: cómo levantarlo y cómo probarlo.

## Stack

| | |
|---|---|
| Framework | Next.js (App Router, server actions) |
| Base de datos | Supabase — Postgres + Auth + RLS |
| Proyecto Supabase | `banlcbewinpjtudzdzhm` ("Ketchum") |
| Deploy | Vercel (cuenta de Archytas) |
| Tests | Playwright (e2e) |

## Pantallas

| Ruta | Qué es |
|------|--------|
| `/hoy` | El editor del día: reordenar, editar, incluir/excluir notas, generar el resumen IA y copiar el HTML para el mail |
| `/historial` | Clippings de días anteriores. Si el usuario exportó ese día ve su HTML exportado; si no, el clipping base reconstruido |
| `/precarga` | Cargar a mano notas que el clipping no encontró, para el día siguiente |
| `/base-datos` | La config del cliente: medios, keywords, secciones, Google Alerts, tiers/Ad Value |
| `/estadisticas` | Métricas de uso por usuario |
| `/actividad` | El embudo de cada corrida (cuántos medios se intentaron, cuántas notas quedaron) |
| `/reportes` | Los errores que reporta el equipo de Ketchum sobre el clipping |
| `/panel-pm` | Solo staff: diff entre lo que mandamos y lo que el cliente dejó |

## Levantarlo en local

Requiere **Docker** corriendo (para la Supabase local) y Node.

```bash
npm install
npx supabase start          # levanta Postgres, Auth y el resto en local
npm run dev                 # http://localhost:3000
```

`.env.local` ya apunta a la Supabase **local** (`http://127.0.0.1:56321`), no a producción.
No lo cambies para "probar rápido": el mandamiento 4 dice que no se prueba contra datos del
cliente.

Usuarios sintéticos de la base local (ver `supabase/seed_dev_user.sql` y `seed_cliente_user.sql`):

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `dev@archytas.local` | `devlocal123` | staff |
| `cliente-e2e@archytas.local` | `clientelocal123` | cliente |

No existen en producción.

## Tests

```bash
npm run test:e2e            # Playwright, contra la Supabase local
npx playwright test e2e/ad-value-miles.spec.ts    # un archivo puntual
```

`playwright.config.ts` levanta el dev server solo y corre con **1 worker** a propósito: los
tests comparten el mismo usuario y la misma base, y en paralelo se pisan.

⚠️ **La suite está roja desde el rename del 24/08** (5 tests buscan la opción
`"BMS - Versión Nueva"` en el selector de cliente, que ya no existe). No es una regresión del
código de la app — son los tests que quedaron desactualizados. Mientras tanto la suite no sirve
como red de seguridad, así que conviene arreglarla antes del próximo cambio grande.

## Migraciones

Viven en `supabase/migrations/`. Se aplican con `npx supabase db push`.

✅ **Historial reconciliado el 07/09/2026.** Antes el repo tenía 41 archivos contra 69
migraciones aplicadas en producción, así que `db push` y `db pull` fallaban. Se bajaron las
**28 que faltaban** (desde `supabase_migrations.schema_migrations`, que guarda el SQL exacto)
y se renumeraron **9** que estaban con un timestamp distinto al del registro. Ahora son
**69 = 69, sin diferencias en ninguna dirección**.

> Lo que se verificó es que **el historial coincide**, que era el bloqueante. Un `db push`
> end-to-end no se probó — eso necesita el link y la password de la base.

**Cómo no volver a romperlo:** si aplicás un cambio con las herramientas de Supabase en vez de
`db push`, la base queda con una migración que el repo no tiene. Cuando pase, bajala:
>
> ```sql
> select version, name, array_to_string(statements, ';') from supabase_migrations.schema_migrations
> where version > '<la ultima que tengas en el repo>' order by version;
> ```
>
> y guardala como `supabase/migrations/<version>_<name>.sql`, con el **mismo** número.

## Cosas que conviene saber antes de tocar

- **Los importes se escriben con separador de miles.** Alcance y Ad Value usan `type="text"` +
  `parseNumeroAr()` de `src/lib/numero.ts`, **no** `type="number"`. El input nativo rechaza
  `7.000.000` y el valor se perdía en silencio (o peor, borraba el anterior). Está cubierto por
  `e2e/ad-value-miles.spec.ts`.
- **`clients` tiene 8 filas, no 4.** Los 4 reales (`bms`, `booking`, `mars`, `msd`) y sus
  `*-legado`, que son el histórico de los clippings v2. Las pantallas de uso diario filtran los
  legado con `ordenarClientesActivos()` (`src/lib/clientes.ts`); Historial los muestra todos.
- **Todo lo editable es por usuario.** `user_clipping_state`, `exports` y `activity` van
  siempre con `user_id`: lo que edita una persona no pisa a otra. RLS activo con
  `has_client_access`.
- **`import_clipping()` es idempotente.** Reemplaza las notas de origen `n8n` del día y preserva
  las cargadas a mano o precargadas. Re-ejecutar no duplica.
