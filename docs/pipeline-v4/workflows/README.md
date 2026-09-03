# Workflows v4 · `ketchum-n8n`

Respaldo de referencia. La **fuente de verdad es la instancia** `ketchum-n8n`
(`n8n-ketchum.archytas.io`, project `lZwDOgXzFudxU5oC`).

| Workflow | ID | Rol | Estado |
|---|---|---|---|
| `v4 · sub · fetch-source` | `UUIlvhTv3Rjy9YEP` | 1 fuente, 1 transporte → `{diagnostico, items[], ...}` + escribe `fetch_log` | activo (inerte, solo corre si lo llaman) |
| `v4 · sub · fetch-escalera` | `TyXVALaeUzfPlgv8` | la escalera directo→cloudflare→aws sobre una fuente. Corta en el primero con items | activo (inerte) |
| `v4 · medición · cobertura (aislado, manual)` | `XpeIOEJg92H1hrrJ` | Manual Trigger. Recorre las ~1.262 fuentes activas por la escalera. Llena `fetch_log` con `pasada='medicion'`. No manda mails ni toca tablas de cliente | **inactivo** — se dispara a mano |

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
