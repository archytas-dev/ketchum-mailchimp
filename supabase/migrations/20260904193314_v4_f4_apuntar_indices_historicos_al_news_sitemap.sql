-- Cuatro de los seis índices históricos declaraban un news_sitemap.xml en su
-- robots.txt que nunca les habíamos buscado. Verificado uno por uno el 04/09:
--
--   infotecrealico.com.ar     1.026 sin fecha  ->  39 con fecha y título
--   rumoresdepehuajo.com.ar   1.025 sin fecha  ->  10 con fecha y título
--   elurbanodesancarlos.com   1.018 sin fecha  ->  12 con fecha y título
--   radiocapital913.com.ar    1.014 sin fecha  ->  10 con fecha y título
--
-- Son las noticias del día en vez del archivo completo. Se les corrige la URL, que
-- es lo que el descubridor hace: apuntar la fuente al recurso correcto.
--
-- Los otros dos (maracodigital.net, novaclima.com.ar) no declaran news_sitemap y no
-- se les encontró alternativa: quedan como estaban y se tratan aparte.

update public.medios_fuentes f
set url_feed   = 'https://' || f.dominio_norm || '/news_sitemap.xml',
    updated_at = now()
where f.dominio_norm in ('infotecrealico.com.ar','rumoresdepehuajo.com.ar',
                         'elurbanodesancarlos.com','radiocapital913.com.ar')
  and f.activa is true;

update public.medios_estrategia e
set url_recurso        = 'https://' || e.dominio_norm || '/news_sitemap.xml',
    ultimo_diagnostico = 'ok',
    fallos_consecutivos = 0,
    updated_at         = now()
where e.dominio_norm in ('infotecrealico.com.ar','rumoresdepehuajo.com.ar',
                         'elurbanodesancarlos.com','radiocapital913.com.ar');
