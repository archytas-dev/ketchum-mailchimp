-- Corrección de la migración 20260918140000.
--
-- Ahí moví los 16 dominios del transporte `aws` (muerto) a `cloudflare`, eligiéndolo
-- porque era el que más volumen exitoso tenía ese día. Fue un criterio equivocado: miré
-- la tasa de éxito global en vez del historial por dominio, y la documentación del propio
-- proyecto ya tenía la respuesta.
--
-- docs/pipeline-v4/pipeline-v4.md mide, el 02/09, medio por medio:
--
--   Medio      RSS directo   Cloudflare   AWS
--   Infobae        ok           403        ok
--
-- Es decir que Cloudflare es justamente la red que Infobae bloquea. Mandarlo ahí lo deja
-- igual de roto que antes, sólo que con otro error. Y el mismo doc explica el porqué:
-- "cada medio arma su propia lista de redes bloqueadas y no se parecen entre sí". Por eso
-- había dos proxies y no uno.
--
-- La salida no es recrear la Edge Function (su fuente no quedó en el repo). Es más simple:
-- n8n sale por 15.229.74.78, que es AWS São Paulo -- la MISMA red donde vivía la Edge
-- Function muerta (18.228.15.182). El doc lo dice en otras palabras: "el EC2 self-hosted de
-- Archytas es AWS, así que ve lo mismo que la Edge Function: entra a Infobae".
--
-- Entonces `directo` desde n8n reproduce exactamente lo que hacía el transporte `aws`, sin
-- infraestructura nueva, sin credenciales y sin costo. Además es el escalón 1 de la escalera
-- definida en el diseño, o sea el que hay que probar primero.
--
-- Respaldo del criterio: entre el 03/09 y el 14/09, con el proxy vivo, estos 16 dominios
-- acumularon 950 fetches con HTTP 200. No son medios rotos; era la red la que importaba.
--
-- El backup de transportes originales de la migración anterior se conserva intacto.

update public.medios_estrategia
   set transporte = 'directo'
 where dominio_norm in (select dominio_norm from public.medios_estrategia_transporte_aws_backup);

update public.medios_fuentes
   set transporte = 'directo'
 where dominio_norm in (select dominio_norm from public.medios_estrategia_transporte_aws_backup)
   and transporte is not null;
