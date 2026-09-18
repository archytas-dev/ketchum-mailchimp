-- ariesonline.com.ar devuelve 403 en TODAS las pasadas del barrido, al menos desde el 17/09:
-- diagnostico 'bloqueado', http 403, 0 articulos, pasada tras pasada. Sale por `cloudflare`.
--
-- Cómo apareció: comparando el clipping de Booking de la v3 contra el de la v4 del 18/09.
-- La v3 traía como exclusiva "Salta empezará a medir las tarifas hoteleras con Booking como
-- principal referencia" -- de Aries On Line -- y la v4 no. La nota no está en candidatas_raw
-- ni una sola vez: nunca la capturamos. La v3 la consiguió por Google Alerts, no scrapeando.
--
-- No es el sitio el que nos rechaza, es la red: su sitemap responde 200 a un pedido normal
-- fuera de n8n. Es el mismo patrón que Infobae pero con el proxy invertido -- a Infobae lo
-- bloquea Cloudflare y lo deja pasar AWS, y acá pasa igual. El doc del proyecto ya lo
-- anticipaba: "cada medio arma su propia lista de redes bloqueadas y no se parecen entre sí".
--
-- Se manda a `directo`, que es la red de n8n (AWS São Paulo) y es lo que recuperó a Infobae
-- esta mañana. No es garantía: la prueba de los 200 se hizo desde una IP residencial y la de
-- n8n es de datacenter. Si sigue en 403 el próximo barrido, el paso siguiente es brightdata,
-- que se paga pero atraviesa.
--
-- Se verifica solo: basta mirar fetch_log para ese dominio en la próxima pasada.

create table if not exists public.medios_estrategia_transporte_aws_backup (
  dominio_norm text primary key,
  transporte_anterior text not null,
  movido_at timestamptz not null default now()
);

insert into public.medios_estrategia_transporte_aws_backup (dominio_norm, transporte_anterior)
select dominio_norm, transporte
  from public.medios_estrategia
 where dominio_norm = 'ariesonline.com.ar'
on conflict (dominio_norm) do nothing;

update public.medios_estrategia
   set transporte = 'directo'
 where dominio_norm = 'ariesonline.com.ar';

update public.medios_fuentes
   set transporte = 'directo'
 where dominio_norm = 'ariesonline.com.ar'
   and transporte is not null;
