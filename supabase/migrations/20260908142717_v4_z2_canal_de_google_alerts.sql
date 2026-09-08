-- [Z.2] El canal que la v4 no tenia.
--
-- Medido el 08/09: de las 238 notas que la v3 mando ese dia, 73 (31%) entraron
-- por Google, y de esas la v4 tenia 30. Las 43 que faltaban eran mas de la mitad
-- de todo su faltante. No era un bug: el diseno se apoyaba en feeds, HTML y el
-- descubridor, y este canal nunca entro en la lista.
--
-- La buena noticia al abrirlo: las alertas YA SON FEEDS RSS. google_alerts.url_rss
-- apunta a un Atom publico de Google. No hace falta inventar transporte ni
-- autenticacion; hace falta leerlos y, sobre todo, DESENVOLVER EL REDIRECT.

-- Las alertas no son medios: una alerta es un tema de un cliente, no un dominio.
-- Meterlas en medios_fuentes habria mezclado dos cosas distintas y roto el
-- catalogo. La nota guarda su dominio REAL (el del medio) y aparte de que alerta
-- vino.
alter table public.candidatas_raw
  add column if not exists alerta_id uuid references public.google_alerts(id) on delete set null;

comment on column public.candidatas_raw.alerta_id is
  'De que alerta de Google vino la nota, si vino por ahi. dominio_norm sigue siendo el dominio REAL del medio, nunca google.com: sin desenvolver el redirect, el pool se llenaria de google y las compuertas por dominio dejarian de funcionar.';

create index if not exists candidatas_raw_alerta_idx on public.candidatas_raw (alerta_id) where alerta_id is not null;

-- El vocabulario de 'pasada' es cerrado. Las alertas son su propio barrido.
alter table public.fetch_log drop constraint if exists fetch_log_pasada_check;
alter table public.fetch_log add constraint fetch_log_pasada_check
  check (pasada = 'medicion'
      or pasada ~ '^barrido_\d{4}-\d{2}-\d{2}_\d{2}$'
      or pasada ~ '^alertas_\d{4}-\d{2}-\d{2}_\d{2}$'
      or pasada ~ '^descubridor_\d{4}-\d{2}-\d{2}$');

-- Pendientes de la ventana, con la misma reentrancia que el barrido de feeds:
-- lo ya hecho en esta hora no se vuelve a pedir. Y en hora ARGENTINA, que es la
-- leccion que ya nos costo dos veces hoy.
create or replace view public.v4_alertas_pendientes as
 select ga.id as alerta_id,
        ga.client_id,
        c.slug as cliente,
        ga.tema,
        ga.url_rss as url
   from google_alerts ga
   join clients c on c.id = ga.client_id
  where ga.activa is true
    and ga.url_rss like 'http%'
    and not exists (
      select 1 from fetch_log l
      where l.dominio_norm = 'alertas.google/' || ga.id::text
        and l.fecha = v4_hoy()
        and l.pasada = ('alertas_' || to_char((now() at time zone 'America/Argentina/Buenos_Aires'), 'YYYY-MM-DD_HH24')))
  order by c.slug, ga.tema;

comment on view public.v4_alertas_pendientes is
  'Alertas de Google activas que faltan traer en la ventana actual. Se registran en fetch_log con dominio_norm = alertas.google/<id> para no inventar un medio que no existe.';

grant select on public.v4_alertas_pendientes to anon, authenticated, service_role;