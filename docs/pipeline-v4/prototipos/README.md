# Prototipos · Clipping v4 — la escalera de transporte

**Estado: construido, cerrado con credenciales y andando. No conectado a producción.**
Los cuatro clippings de hoy siguen corriendo exactamente igual. Esto queda listo para
el día que se decida usarlo.

---

## El problema que resuelve

Un medio puede tener un RSS impecable y ser inalcanzable desde la IP de n8n. Hoy eso
se anota como "el RSS no anda" y el medio se abandona. Ahí están los 359 medios que
nunca visitamos.

**Y no hay una sola salida que sirva para todos.** Medido el 02/09/2026:

| Medio | RSS directo | Cloudflare | AWS |
|---|---|---|---|
| Infobae | ok | **403** | ok |
| mundiario.com | ok | ok | **403** |
| trt.com.ar | ok | ok | **403** |
| el1digital.com.ar | ok | ok | **403** |
| diariotag.com | ok | ok | **403** |

Cada medio arma su propia lista de redes bloqueadas y no se parecen entre sí. Por eso
hay **dos** proxies y no uno.

---

## Las dos piezas

| Pieza | URL | Auth | Código |
|---|---|---|---|
| Proxy Cloudflare | `https://ketchum-fetch-proxy.hola-e13.workers.dev/` | `X-Api-Key` | `cloudflare-worker/src/index.js` |
| Proxy AWS | `https://tufgbajqgjkwqwskkcam.supabase.co/functions/v1/fetch-proxy` | `Authorization: Bearer` | desplegado vía MCP, fuente en el doc |

Los dos devuelven **el mismo contrato JSON** a propósito: quien los llama no necesita
saber por cuál salió.

### Credenciales en n8n

Ya creadas en `archytasai.app.n8n.cloud`. **Nunca en un nodo Set.**

| Credencial | ID | Header |
|---|---|---|
| `Ketchum — Fetch Proxy (Cloudflare)` | `PKPV9bTP9T8wZAHJ` | `X-Api-Key: <secret>` |
| `Ketchum — Fetch Proxy (AWS/Supabase)` | `7OwKt737r1MWbn7d` | `Authorization: Bearer <anon>` |

La key de Cloudflare está también en `~/.archytas-ketchum-proxy.key` (permisos 600) en
la máquina de Fede. **Pasarla al gestor de contraseñas del equipo** — hoy existe en un
solo lugar y si se pierde hay que rotarla y re-crear la credencial.

---

## Cómo se usa

### Un pedido

    GET <proxy>/?url=<url-encoded>          -> JSON con los items parseados
    GET <proxy>/?url=<url-encoded>&raw=1    -> los bytes tal cual, para diagnosticar

### La respuesta

```json
{
  "ok": true,
  "diagnostico": "ok",
  "formato": "rss",
  "upstream_status": 200,
  "bytes_upstream": 10762,
  "total": 10,
  "con_fecha": 10,
  "ms": 9,
  "items": [
    { "titulo": "...", "url": "https://...", "fecha": "Tue, 02 Sep 2026 ...", "snippet": "..." }
  ]
}
```

**El campo que importa es `diagnostico`**, y está separado del contenido a propósito:

| Valor | Qué significa | Qué hacer |
|---|---|---|
| `ok` | Trajo notas | Seguir |
| `bloqueado` | 403 o 401 — no nos dejan entrar | **Bajar un escalón** |
| `sin_items` | Es un feed válido y está vacío | **Nada. No es una falla** |
| `no_es_feed` | Respondió pero no es XML | Revisar la URL del catálogo |
| `no_existe` | 404 | Corregir la URL |
| `caido` | 5xx | Reintentar en la pasada siguiente |
| `timeout` | No respondió en 15 s | Reintentar |
| `rate_limit` | 429 | Espaciar |

Sin esta separación el sistema no puede distinguir *"no hubo noticias"* de *"no pudimos
entrar"*, que es la causa de que hoy nada se ponga en rojo.

### La escalera, en orden

```
1. fetch directo desde n8n     gratis, el mas rapido
2. proxy Cloudflare            gratis, 100.000/dia
3. proxy AWS                   gratis, 500.000/mes
4. Bright Data                 se paga, USD 1,50 / 1.000
```

Se corta en el primero que trae notas. Se pasa al siguiente **solo** con
`diagnostico` en `bloqueado`, `caido` o `timeout` — nunca con `sin_items`.

### Desde un nodo Code de n8n

```js
const PROXIES = [
  { nombre: 'cloudflare', url: 'https://ketchum-fetch-proxy.hola-e13.workers.dev/?url=' },
  { nombre: 'aws',        url: 'https://tufgbajqgjkwqwskkcam.supabase.co/functions/v1/fetch-proxy?url=' },
];
const REINTENTAR = ['bloqueado', 'caido', 'timeout'];

// Las credenciales van en el nodo HTTP Request, no acá.
async function traer(feedUrl, headersPorProxy) {
  for (const p of PROXIES) {
    const r = await this.helpers.httpRequest({
      method: 'GET',
      url: p.url + encodeURIComponent(feedUrl),
      headers: headersPorProxy[p.nombre],
      timeout: 30000,
      json: true,
    });
    if (r.total > 0) return { ...r, transporte: p.nombre };
    if (!REINTENTAR.includes(r.diagnostico)) return { ...r, transporte: p.nombre };
  }
  return { total: 0, diagnostico: 'sin_salida', items: [] };
}
```

**Lo importante es guardar `transporte` en el catálogo.** Sin eso, cada corrida vuelve
a probar los cuatro escalones para cada medio y el sistema no aprende nunca.

---

## Lo medido (02/09/2026, 38 feeds reales)

| | Cloudflare | AWS | **Combinado** |
|---|---|---|---|
| Resueltos de 38 | 33 | 30 | **34** |
| Items | 578 | 551 | **638** |
| Con fecha | 100% | 100% | **100%** |
| Egress ahorrado al parsear | 90,8% | 92,2% | — |
| Latencia p50 | 1.049 ms | 260 ms | — |

Los 4 que no resuelve nadie **no son bloqueo**: 2 feeds genuinamente vacíos, 1 sitio
caído, 1 URL mal cargada en nuestro catálogo.

**Ninguno de los 38 necesitó Bright Data.**

### Por qué parsea en vez de devolver el XML

El feed de Infobae pesa 952 KB y el clipping solo usa titulo, url, fecha y descripción.
Devolviendo crudo son ~16 GB/mes; parseado son 1,3 GB. Y como el parseo pasa del lado
del proxy, **la fecha del feed no se pierde** — que es exactamente lo que sí pasa si se
usa Jina para esto.

---

## Lo que NO sirve, ya probado

| Servicio | Por qué no |
|---|---|
| feed2json.org | Deprecado + 50/hora. Dice literal: *"Please don't use this service for production"* |
| toptal (su sucesor) | Mismo límite de 50/hora |
| rss2json.com | 77 de 90 requests dieron 429 |
| allorigins · codetabs | 522, caídos |
| corsproxy.io | 401, ahora pide key |
| morss.it | Timeout a los 25 s |
| thingproxy | El dominio no resuelve |
| **Jina Reader** | **Para feeds no sirve**: devuelve markdown y se pierde la fecha. Probadas 5 formas de pedirle el crudo, ninguna funciona. Para páginas HTML sigue siendo la mejor que tenemos |

**No es que no apareció el bueno: no existe.** Convertir XML a JSON son veinte líneas;
el valor es la IP y el ancho de banda, y eso cuesta plata.

---

## Costos

| Escalón | Plan | Incluye | Necesitamos |
|---|---|---|---|
| Cloudflare Workers | Gratis | 100.000 req/día | ~5.300/día |
| Supabase Edge Functions | Gratis | 500.000 inv/mes · 5 GB egress | ~160.000 · 1,3 GB |
| Bright Data | USD 1,50/1.000 | 5.000 gratis/mes | 0 en la prueba |

Archytas **no tiene cuenta ni factura de AWS**. Le decimos "AWS" porque es la red que ve
el medio del otro lado: Supabase alquila servidores en Amazon.

---

## Cómo mantenerlo

**Cambiar el código del Worker:**

    cd prototipos/cloudflare-worker
    npx wrangler deploy

**Rotar la key de Cloudflare:**

    openssl rand -hex 32 > ~/.archytas-ketchum-proxy.key
    tr -d '\n' < ~/.archytas-ketchum-proxy.key | npx wrangler secret put PROXY_KEY
    npx wrangler deploy

Después actualizar la credencial `PKPV9bTP9T8wZAHJ` en n8n con el valor nuevo.

**Ver consumo:** https://dash.cloudflare.com → Workers & Pages → ketchum-fetch-proxy

---

## Pendientes

- [ ] **Medir los 359 medios que hoy nunca entran, desde n8n.** Es el número que decide
      si esto vale la pena. Workflow aislado, sin trigger, sin mails, sin escribir en
      tablas del cliente.
- [ ] Crear `medios_catalogo` con la columna `transporte`. Sin eso el sistema no aprende.
- [ ] Decidir dónde vive la Edge Function en producción: proyecto de Ketchum, o uno
      aparte compartido por los cuatro (recomendado — la ingesta ya es compartida).
- [ ] Pasar la key de Cloudflare al gestor de contraseñas del equipo.
- [ ] Coordinar con Adrián antes de tocar cualquier flujo: la v3 está en vuelo.

## Lo que conviene tener presente antes de implementar

De 2.808 notas que BMS trae por día, 46 llegan al cliente: **se descarta el 98%**.
Recuperar 250 medios más sube el numerador, no lo que ve Fedra. **El transporte solo se
nota si el filtro mejora al mismo tiempo.** Ver §5 y §6 de `pipeline-v4.md`.
