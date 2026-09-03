# Deploy del fetch-proxy en Cloudflare Workers

Tres comandos, con la cuenta de Cloudflare de Archytas.

    npx wrangler login
    npx wrangler secret put PROXY_KEY      # inventar una key larga y guardarla en n8n
    npx wrangler deploy

Queda en `https://ketchum-fetch-proxy.<subdominio>.workers.dev`.

## Probarlo

    curl -H "X-Api-Key: <la key>" \
      "https://ketchum-fetch-proxy.<subdominio>.workers.dev/?url=https%3A%2F%2Fwww.clarin.com%2Frss%2Fpolitica%2F"

Tiene que devolver `"diagnostico":"ok"` con 10 items y los 10 con fecha.

## Correr el benchmark completo

En `archytas-docs/clientes/ketchum/prototipos/` estan los 38 feeds de la prueba.
Correrlos contra el Worker y comparar con la tabla de resultados de abajo.

## Lo que ya sabemos, medido el 02/09/2026

| Plataforma | IP de salida | Red | Resueltos de 38 |
|---|---|---|---|
| Supabase Edge Functions | 18.228.15.182 | AWS Sao Paulo | 30 |
| Cloudflare Workers | 2a06:98c0:3600::103 | Cloudflare | ~34 (proyectado) |

Los 4 medios que le dan 403 a Supabase (`mundiario.com`, `trt.com.ar`,
`el1digital.com.ar`, `diariotag.com`) pasan por Cloudflare sin problema:
bloquean IPs de AWS, no de Cloudflare.

**Esto tambien aplica al EC2 self-hosted**: es AWS, asi que heredaria el mismo
bloqueo. Migrar n8n a la VM no reemplaza al proxy.

## Limites del plan gratis

| Que | Limite | Lo que necesitamos |
|---|---|---|
| Requests | 100.000/dia | ~5.300/dia |
| CPU por invocacion | 10 ms | el fetch no cuenta como CPU, solo el parseo |
| Subrequests por invocacion | 50 | 1 |

## Pendiente antes de produccion

- [ ] Deployarlo y correr el benchmark de 38 feeds para tener el numero real
- [ ] Correrlo DESDE n8n contra los 359 medios que hoy nunca entran, y comparar
      con el fetch directo. Ese es el numero que decide cuanto se recupera.
- [ ] Los que ni Cloudflare pasa van a Bright Data
