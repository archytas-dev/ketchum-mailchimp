-- El transporte `aws` está caído desde el 16/09 y se lleva puestos 16 dominios.
--
-- Medido sobre fetch_log:
--   hasta el 14/09  ~97-99% OK
--   15/09           146 intentos, 27 errores (empieza a degradarse)
--   16/09           174 intentos, 0 OK
--   17/09           151 intentos, 0 OK
--   18/09            50 intentos, 0 OK
--
-- Todos fallan igual: diagnostico='error' y http_status NULL, o sea que ni siquiera hay
-- respuesta HTTP -- se cae el transporte, no el sitio. Los otros tres transportes están
-- sanos el mismo día: cloudflare 2424/2752, directo 656/668, brightdata 64/72.
--
-- Y los feeds están bien: probados uno por uno fuera de n8n, infobae.com/economia y
-- /salud devuelven 200, curecompass 200, expoknews 301 (redirect que el fetcher sigue).
--
-- El más caro de los 16 es infobae.com (6 fuentes activas, Tier 1). Comparando el clipping
-- de hoy contra el de la v3, varias notas que la v3 trajo por Google y la v4 no vio son
-- justamente de Infobae.
--
-- Esto es un PUENTE, no la solución: lo correcto es levantar el proxy AWS. Cuando vuelva,
-- revertir con:
--   update public.medios_estrategia set transporte='aws'
--    where dominio_norm in (select dominio_norm from public.medios_estrategia_transporte_aws_backup);
--
-- Se elige cloudflare y no directo porque estos dominios estaban deliberadamente detrás de
-- un proxy: si alguno necesita IP de datacenter distinta, cloudflare la da. Si mañana alguno
-- sigue fallando, el próximo intento es 'directo'.

-- Backup para poder volver atrás sin adivinar.
create table if not exists public.medios_estrategia_transporte_aws_backup (
  dominio_norm text primary key,
  transporte_anterior text not null,
  movido_at timestamptz not null default now()
);

insert into public.medios_estrategia_transporte_aws_backup (dominio_norm, transporte_anterior)
select dominio_norm, transporte
  from public.medios_estrategia
 where transporte = 'aws'
on conflict (dominio_norm) do nothing;

update public.medios_estrategia
   set transporte = 'cloudflare'
 where transporte = 'aws';

-- Por si alguna fuente tiene el transporte fijado a mano en vez de heredarlo.
update public.medios_fuentes
   set transporte = 'cloudflare'
 where transporte = 'aws';
