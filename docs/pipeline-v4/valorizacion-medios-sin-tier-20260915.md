# Valorización: por qué 7 de cada 10 notas salen sin Ad Value

Medido el 2026-09-15 sobre **6.688 notas** de los últimos 30 días, los cuatro clientes vivos.
Material para la conversación con Fedra. Refina `[W5.11]`–`[W5.16]` del
[roadmap de la webapp](./roadmap-webapp-v4.md).

---

## 1. El número

| Cliente | Notas 30d | Con Ad Value | % |
|---|---:|---:|---:|
| Booking | 1.638 | 608 | 37,1 % |
| Mars | 2.592 | 816 | 31,5 % |
| MSD | 964 | 261 | 27,1 % |
| BMS | 1.494 | 301 | 20,1 % |
| **Total** | **6.688** | **1.986** | **29,7 %** |

---

## 2. En qué se descompone el 70 % que falta

Y, sobre todo, **de quién es cada parte**:

| | Notas | % del total | Quién lo resuelve |
|---|---:|---:|---|
| **A.** Ya valorizadas | 1.986 | 29,7 % | — |
| **B.** El cruce falla por la clave de nombre | 863 | 12,9 % | **Nosotros** (código) |
| **C.** El medio está cargado en `tiers` con el valor en blanco | 147 | 2,2 % | **Fedra** (poner el número) |
| **D.** El medio llegó como dominio pelado (`lanacion.com.ar`) | 896 | 13,4 % | **Nosotros** (código) |
| **E.** El medio no está en `tiers` | **2.796** | **41,8 %** | **Fedra / el equipo** |

**El techo de lo que podemos arreglar nosotros es pasar de 29,7 % a ~56 %** (B + D). El resto
depende de que alguien cargue medios y valores.

> **Corrección a lo que dijimos antes.** El diagnóstico anterior era *"el dato existe y no
> cruza"*. Es cierto para el 13 % (B), no para el 42 % (E). `Infobae` está cargado para BMS con
> `tier` y `ad_value` en `null`; `La Voz del Interior`, igual. No es que no crucen: nunca se les
> asignó valor.

---

## 3. Dónde se concentra

Mars es el caso más concentrado: **12 medios explican el 61 %** de su faltante. Los otros tres
son cola larga.

| Cliente | Medios distintos sin valor | 12 primeros cubren |
|---|---:|---:|
| Mars | — | **61 %** |
| BMS | — | 29 % |
| MSD | — | 25 % |
| Booking | — | 26 % |

Los 20 medios más frecuentes del total explican **1.158 notas**.

### Los primeros de cada cliente

**Mars** — Dbiz Today (146) · El Tribuno (133) · El Tribuno de Jujuy (96) · El Sitio Avícola (77) ·
Corrientes Hoy (63) · ANRoca (63) · Mitre y el Campo (61) · Valor Agro (48)

**BMS** — Diagnostics News (77) · Infobae (51) · Infobae Salud (46) · Pharmabiz (31) ·
Consenso Salud (20) · DIB Últimas Noticias (19) · La Nación Salud (14)

**Booking** — Daily Web (62) · La Voz (22) · argentina.ladevi.info (22) · Revista Mercado (18) ·
Radar de Viajes (17) · Aviones (13) · Magazine Turístico Digital (12)

**MSD** — Motivar ·Sanidad Animal (21) · Masp (16) · Mitreyelcampo (15) ·
Motivar ·Agro (15) · Motivar ·Animales de Compañía (14) · Valoragro (13) · Motivar ·Ganadería (13)

---

## 4. El hallazgo que cambia el reparto del trabajo

**Una parte importante del bucket E no son medios nuevos: son variantes de nombre de medios que
ya tienen tier cargado.**

| Lo que llega en la nota | Lo que está cargado |
|---|---|
| `El Tribuno de Jujuy` | `El Tribuno de Jujuy/Salta` |
| `Motivar - Sanidad Animal`, `- Agro`, `- Animales de Compañía`, `- Ganadería` | `Motivar` |
| `La Nación Salud` | `La Nación` |
| `Puntal Salud` | `Puntal` |
| `Corrientes Hoy` | `Corrientes Hoy (Ctes Hoy)` |
| `Radar de Viajes` | `RADAR VIAJES` |
| `Valoragro` | `Valor Agro` |
| `Mitreyelcampo` | `Mitre y el Campo` |

Son dos causas distintas mezcladas: los `Motivar - *` y `La Nación Salud` vienen de que un mismo
medio tiene **feeds separados por sección**, y cada sección llega con su propio nombre. El resto
son variantes de escritura.

**Esto no lo tiene que cargar Fedra: se resuelve con una tabla de alias.** `tier_alias` ya existe
en la base — **con 0 filas y sin que ninguna función la lea**. Es infraestructura construida y
nunca conectada.

> ⚠️ **El emparejado automático de esta sección no es confiable como lista de trabajo.** Lo hice
> por prefijo y produce falsos positivos claros (`Diagnostics News` → `El Día`,
> `Consenso Salud` → `Diario C`, `El Sitio Avícola` → `Sitios de gobierno`). Sirve para mostrar
> que **el patrón existe y es grande**, no para aplicarlo sin que alguien lo mire.

---

## 5. Qué proponer, y en qué orden

1. **Alias de nombre** (`tier_alias`, ya existe): resuelve las variantes y los feeds por sección
   sin que el cliente cargue nada. Hay que hacer que `armar_clipping` y `v4_email_tier_lookup`
   la lean, y armar la lista inicial con revisión humana.
2. **Cruce por dominio** (bucket D, 896 notas): cuando el medio llega como dominio pelado, hoy no
   hay forma de cruzarlo. Es `[W5.12]`/`[W5.13]`: `tiers.dominio_norm` + FK a `medios_catalogo`.
3. **Unificar el normalizador** (bucket B, 863 notas): `[W5.11]`.
4. **Lo que sí es de Fedra:** los 147 del bucket C (poner el número a lo ya cargado) y los medios
   del bucket E que realmente no existen — empezando por los 12 de Mars, que solos son el 61 %
   de su faltante.

---

## 6. La advertencia importante

**Nada de los puntos 1 a 3 mejora el clipping que Fedra recibe mañana.**

El cruce de valorización de la v3 se hace en un nodo de código de n8n, no en SQL. Arreglar
`armar_clipping` mejora **el camino v4**, que todavía no está activo para ningún cliente. Para
que los 863 + 896 lleguen al clipping de hoy habría que tocar los workflows v3 — que es
exactamente el desarrollo sobre la v3 que se acordó frenar.

**Lo único de esta lista con efecto inmediato es lo del punto 4: cargar valores.** Eso sí cambia
el clipping de mañana, y no lo hacemos nosotros.
