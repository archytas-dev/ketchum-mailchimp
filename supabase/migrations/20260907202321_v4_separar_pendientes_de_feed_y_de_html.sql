-- Las fuentes sin feed salen del recolector de feeds y pasan al suyo.
--
-- v4_recoleccion_pendientes incluia `metodo_extraccion='html'` SIN mirar el
-- transporte. Mientras esas fuentes no tenian transporte no molestaba: quedaban
-- como 'no_visitado' (los 210 que reporta cada barrido). Pero apenas se les
-- escriba el transporte, el recolector de FEEDS las iba a agarrar, pedirles la
-- pagina, recibir HTML, decir "esto no es un feed" y traer cero notas — nueve
-- veces por dia, ~1.600 visitas diarias a cambio de nada.
--
-- Se parten en dos vistas en vez de meterle una rama al recolector principal:
-- ese flujo ya esta probado y le costo cuatro bugs encontrados a los golpes;
-- abrirlo para esto es arriesgar lo que funciona. Y separados, cada uno tiene su
-- tanda y su tope de memoria, que en HTML pesa mucho mas (154 KB por pagina
-- medidos, contra unos pocos KB de un feed).

create or replace view public.v4_recoleccion_pendientes as
  select f.id as fuente_id,
         f.dominio_norm,
         coalesce(e.url_recurso, f.url_feed) as url,
         e.formato,
         e.transporte,
         e.metodo_extraccion
  from medios_fuentes f
  join medios_estrategia e on e.dominio_norm = f.dominio_norm
  where f.activa is true
    and e.metodo_extraccion = 'feed'
    and e.transporte is not null
    and coalesce(e.url_recurso, f.url_feed) like 'http%'
    -- Reentrancia: dentro de la misma ventana no se reintenta lo ya intentado.
    -- La vista se vacia sola a medida que avanza el barrido, por eso el
    -- recolector se llama siempre con offset=0.
    and not exists (
      select 1 from fetch_log l
      where l.fuente_id = f.id
        and l.fecha = current_date
        and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD_HH24')
    )
  order by f.dominio_norm;

comment on view public.v4_recoleccion_pendientes is
  'Fuentes CON feed que faltan recolectar en la ventana actual. Las de metodo_extraccion=html viven en v4_recoleccion_html_pendientes: el recolector de feeds no sabe leer una pagina.';

create or replace view public.v4_recoleccion_html_pendientes as
  select f.id as fuente_id,
         f.dominio_norm,
         coalesce(e.url_recurso, 'https://' || f.dominio_norm) as url,
         e.transporte
  from medios_fuentes f
  join medios_estrategia e on e.dominio_norm = f.dominio_norm
  where f.activa is true
    and e.metodo_extraccion = 'html'
    -- Sin transporte medido no se sale a buscar: primero pasa por wf/medir-html,
    -- que sube la escalera y recien ahi escribe por donde entra.
    and e.transporte is not null
    and not exists (
      select 1 from fetch_log l
      where l.fuente_id = f.id
        and l.fecha = current_date
        and l.pasada = 'barrido_' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD_HH24')
    )
  order by f.dominio_norm;

comment on view public.v4_recoleccion_html_pendientes is
  'Fuentes SIN feed, con transporte ya medido, que faltan recolectar en la ventana actual. Las lee wf/recolector-html, que extrae las notas del HTML de la home.';

grant select on public.v4_recoleccion_pendientes to anon, authenticated, service_role;
grant select on public.v4_recoleccion_html_pendientes to anon, authenticated, service_role;
