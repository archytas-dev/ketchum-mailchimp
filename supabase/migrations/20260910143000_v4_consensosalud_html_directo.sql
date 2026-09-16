-- Consenso Salud estaba configurado como sitemap, pero la URL guardada es la
-- portada. El descubridor la descartaba como `no_es_feed` y nunca entraba al
-- recolector HTML. La v3 la abría como página (Jina); en v4, las páginas de
-- este tipo se procesan con extracción HTML y transporte directo.

update public.medios_fuentes
set formato = 'html',
    url_feed = 'https://consensosalud.com.ar/',
    updated_at = now()
where id = '1247d752-a922-4973-a43f-ac3f2855b8e8';

update public.medios_estrategia
set formato = 'html',
    metodo_extraccion = 'html',
    transporte = 'directo',
    url_recurso = 'https://consensosalud.com.ar/',
    fallos_consecutivos = 0,
    ultimo_diagnostico = null,
    updated_at = now()
where dominio_norm = 'consensosalud.com.ar';
