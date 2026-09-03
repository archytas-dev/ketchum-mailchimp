// Ketchum · fetch-proxy sobre Cloudflare Workers
//
// Resuelve el caso "el medio tiene RSS pero n8n no puede entrar": baja el feed desde
// la red de Cloudflare y devuelve los items ya parseados.
//
// Por que Cloudflare y no Supabase (medido 02/09/2026):
//   Supabase Edge Functions sale desde AWS Sao Paulo (18.228.15.182) y 4 de 38 medios
//   le devuelven 403. Cloudflare Workers sale desde su propia red y esos 4 pasan.
//   Ademas Cloudflare da 100.000 requests/dia gratis y no factura egress igual que
//   Supabase, que solo da 5 GB/mes.
//
// Por que parsea en vez de devolver el XML crudo:
//   el clipping solo usa titulo, url, fecha y descripcion. Devolver el feed entero
//   son ~950 KB por medio grande y no aporta nada. Parsear aca ademas CONSERVA LA
//   FECHA del feed, que es justo lo que se pierde si se usa Jina para esto.
//
// Uso:
//   GET /?url=<url-encoded>          -> JSON con los items parseados
//   GET /?url=<url-encoded>&raw=1    -> los bytes tal cual, para diagnostico
//   Header: X-Api-Key: <PROXY_KEY>

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TIMEOUT_MS = 15000;
const MAX_ITEMS = 60;

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : '';
}

function clean(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeed(xml) {
  const out = [];
  const re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) && out.length < MAX_ITEMS) {
    const b = m[2];
    let url = clean(tag(b, 'link'));
    if (!url) url = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || ['', ''])[1];
    const fecha =
      clean(tag(b, 'pubDate')) ||
      clean(tag(b, 'published')) ||
      clean(tag(b, 'updated')) ||
      clean(tag(b, 'dc:date'));
    const titulo = clean(tag(b, 'title'));
    const snippet = (clean(tag(b, 'description')) || clean(tag(b, 'summary'))).slice(0, 400);
    if (titulo || url) out.push({ titulo, url, fecha, snippet });
  }
  return out;
}

function parseSitemap(xml) {
  const out = [];
  const re = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  let m;
  while ((m = re.exec(xml)) && out.length < MAX_ITEMS) {
    const b = m[1];
    const url = clean(tag(b, 'loc'));
    if (!url) continue;
    out.push({
      titulo: clean(tag(b, 'news:title')) || clean(tag(b, 'title')),
      url,
      fecha: clean(tag(b, 'news:publication_date')) || clean(tag(b, 'lastmod')),
      snippet: '',
    });
  }
  return out;
}

// El diagnostico va SEPARADO del contenido: un 403 no es "el feed esta vacio".
// Sin esto el sistema no puede distinguir "no hubo noticias" de "no pudimos entrar",
// que es la causa de que hoy nada se ponga en rojo.
function diagnosticar(status, esFeed, cantidad) {
  if (status === 403 || status === 401) return 'bloqueado';
  if (status === 404) return 'no_existe';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'caido';
  if (status !== 200) return 'http_' + status;
  if (cantidad > 0) return 'ok';
  return esFeed ? 'sin_items' : 'no_es_feed';
}

export default {
  async fetch(request, env) {
    const t0 = Date.now();
    const qs = new URL(request.url).searchParams;

    const json = (status, obj) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });

    if (env.PROXY_KEY && request.headers.get('X-Api-Key') !== env.PROXY_KEY) {
      return json(401, { ok: false, error: 'no autorizado' });
    }

    const target = qs.get('url');
    if (!target) return json(400, { ok: false, error: 'falta ?url=' });

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return json(400, { ok: false, error: 'url invalida' });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return json(400, { ok: false, error: 'protocolo no permitido' });
    }

    try {
      const r = await fetch(parsed.toString(), {
        headers: {
          'User-Agent': UA,
          Accept:
            'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
          'Accept-Language': 'es-AR,es;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const text = await r.text();

      if (qs.get('raw') === '1') {
        return new Response(text, {
          status: 200,
          headers: {
            'Content-Type': r.headers.get('content-type') || 'text/plain',
            'X-Upstream-Status': String(r.status),
          },
        });
      }

      const head = text.slice(0, 4000);
      const esFeed = /<rss|<feed\b|<channel/i.test(head);
      const esSitemap = /<urlset|<sitemapindex/i.test(head);
      const items = esFeed ? parseFeed(text) : esSitemap ? parseSitemap(text) : [];

      return json(200, {
        ok: items.length > 0,
        diagnostico: diagnosticar(r.status, esFeed || esSitemap, items.length),
        formato: esFeed ? 'rss' : esSitemap ? 'sitemap' : 'desconocido',
        upstream_status: r.status,
        bytes_upstream: text.length,
        total: items.length,
        con_fecha: items.filter((i) => i.fecha).length,
        ms: Date.now() - t0,
        items,
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      return json(200, {
        ok: false,
        diagnostico: /timeout|abort/i.test(msg) ? 'timeout' : 'error_red',
        error: msg.slice(0, 200),
        ms: Date.now() - t0,
      });
    }
  },
};
