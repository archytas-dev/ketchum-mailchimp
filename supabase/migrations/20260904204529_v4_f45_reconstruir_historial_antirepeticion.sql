-- [F4.5] Reconstruir el historial anti-repetición con la URL canónica.
--
-- Estado medido el 04/09: 9.806 filas, de las cuales 5.243 (53%) eran URLs de
-- redirector crudas. Una URL de redirector nunca vuelve a matchear la real, así que
-- esas notas se podían re-enviar para siempre: es la mitad del reporte "nota vieja o
-- repetida".
--
-- Qué se puede arreglar y qué no:
--   3.075 del formato ?url= / ?q=  -> SE RECUPERAN, la URL real estaba ahí adentro
--   2.168 del formato base64       -> IRRECUPERABLES, ver abajo
--
-- Por qué las base64 no tienen arreglo: el normalizador de la v3 pasaba TODA la URL a
-- minúsculas, incluido el token. Base64 distingue mayúsculas, así que 'CBMiK2h0...'
-- quedó 'cbmik2h0...' y la información se destruyó en el momento de guardar. No hay
-- de dónde recuperarla.
--
-- (Esto valida una decisión del diseño v4: url_canonica() pasa a minúsculas SOLO el
-- host, nunca el path ni el query. Por eso la v4 no destruye estos tokens.)
--
-- Las 47 colisiones son la misma nota guardada dos veces con URLs distintas — que es
-- exactamente el bug que este arreglo persigue. Se consolidan sumando veces_repetida
-- y conservando la primera aparición.

-- 1. Backup, por si hay que volver.
create table if not exists public.notas_historico_url_backup_20260904 as
  select * from public.notas_historico_url;

-- 2. Consolidar lo que colisiona al recanonizar.
with recanon as (
  select id, client_id, url_canonica(url_norm) as nueva, primera_vez_fecha,
         veces_repetida, titulo, medio,
         row_number() over (partition by client_id, url_canonica(url_norm)
                            order by primera_vez_fecha, created_at) as rn,
         sum(veces_repetida) over (partition by client_id, url_canonica(url_norm)) as veces_total,
         min(primera_vez_fecha) over (partition by client_id, url_canonica(url_norm)) as primera_real
  from public.notas_historico_url
),
ganadoras as (
  update public.notas_historico_url h
  set url_norm          = r.nueva,
      veces_repetida    = r.veces_total,
      primera_vez_fecha = r.primera_real
  from recanon r
  where h.id = r.id and r.rn = 1
  returning h.id
)
delete from public.notas_historico_url h
using recanon r
where h.id = r.id and r.rn > 1;

comment on table public.notas_historico_url is
  'Historial de lo ya enviado, por cliente. url_norm guarda la URL CANÓNICA (url_canonica()), no la cruda: si guarda un redirector nunca vuelve a matchear la nota real y la repetición no se detecta. Reconstruido el 04/09 — 3.075 filas recuperadas del formato ?url=. Quedan ~2.168 con token base64 destruido por el lowercase de la v3: son irrecuperables y solo pueden fallar dejando pasar una repetición, nunca bloqueando de más.';
