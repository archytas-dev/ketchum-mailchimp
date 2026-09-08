-- Regresion propia, encontrada al revisar por que la v4 no traia notas que la v3
-- si trae.
--
-- Las dos vistas de pendientes evitan repetir una fuente dentro de la misma
-- ventana con: l.fecha = CURRENT_DATE and l.pasada = 'barrido_<YYYY-MM-DD_HH>'.
-- La pasada ya se calculaba en hora ARGENTINA; la fecha se comparaba contra
-- CURRENT_DATE, que es UTC. Mientras fetch_log.fecha tambien era UTC, los dos
-- lados coincidian por accidente.
--
-- Al pasar el default de fetch_log.fecha a v4_hoy() (hora argentina), los dos
-- lados dejaron de coincidir entre las 21:00 y las 24:00 ART: la condicion NOT
-- EXISTS no encontraba nada y la ventana de las 23:00 habria vuelto a recolectar
-- las fuentes ya hechas. No rompia datos —el pool deduplica— pero era una pasada
-- entera de trabajo al pedo, todas las noches.
--
-- Es la misma leccion de siempre: arreglar la mitad de un desfase horario deja
-- las dos mitades peor que antes de tocar nada.

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
    and e.metodo_extraccion = 'feed'::text
    and e.transporte is not null
    and coalesce(e.url_recurso, f.url_feed) like 'http%'
    and not exists (
      select 1 from fetch_log l
      where l.fuente_id = f.id
        and l.fecha = v4_hoy()
        and l.pasada = ('barrido_'::text || to_char((now() at time zone 'America/Argentina/Buenos_Aires'::text), 'YYYY-MM-DD_HH24'::text)))
  order by f.dominio_norm;

create or replace view public.v4_recoleccion_html_pendientes as
 select f.id as fuente_id,
    f.dominio_norm,
    coalesce(e.url_recurso, 'https://'::text || f.dominio_norm) as url,
    e.transporte
   from medios_fuentes f
     join medios_estrategia e on e.dominio_norm = f.dominio_norm
  where f.activa is true
    and e.metodo_extraccion = 'html'::text
    and e.transporte is not null
    and not exists (
      select 1 from fetch_log l
      where l.fuente_id = f.id
        and l.fecha = v4_hoy()
        and l.pasada = ('barrido_'::text || to_char((now() at time zone 'America/Argentina/Buenos_Aires'::text), 'YYYY-MM-DD_HH24'::text)))
  order by f.dominio_norm;