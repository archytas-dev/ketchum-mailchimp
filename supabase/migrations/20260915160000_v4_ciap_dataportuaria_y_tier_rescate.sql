-- CIAP tiene una lista HTML estable de noticias. La fuente existia pero estaba
-- inactiva y sin estrategia, por lo que MSD nunca la intentaba.
update public.medios_fuentes
set activa = true,
    formato = 'html',
    url_feed = 'https://www.ciap.org.ar/Sitio/Sipu/Noticias.jsp',
    metodo_extraccion = 'html',
    transporte = 'directo',
    updated_at = now()
where dominio_norm = 'ciap.org.ar'
  and lower(coalesce(seccion, '')) = 'portada';

insert into public.medios_estrategia (
  dominio_norm, formato, transporte, url_recurso, metodo_extraccion,
  funciona_desde, ultimo_diagnostico, updated_at
)
values (
  'ciap.org.ar', 'html', 'directo',
  'https://www.ciap.org.ar/Sitio/Sipu/Noticias.jsp', 'html',
  now(), 'ok', now()
)
on conflict (dominio_norm) do update
set formato = excluded.formato,
    transporte = excluded.transporte,
    url_recurso = excluded.url_recurso,
    metodo_extraccion = excluded.metodo_extraccion,
    updated_at = now();

-- Data Portuaria migro de .ar a .com. El dominio y URL legacy devuelven 404;
-- el sitemap hijo es XML real. Se usa Cloudflare porque parsea sitemap con un
-- tope de 60 items y evita cargar el XML completo (~1.5 MB) en n8n.
-- medios_fuentes referencia al catalogo: el .com debe existir antes de migrar
-- la fuente legacy.
insert into public.medios_catalogo (
  dominio_norm, nombre, pais, estado, notas, updated_at
)
values (
  'dataportuaria.com', 'Data Portuaria', 'Argentina', 'activo',
  'Dominio actual; reemplaza la fuente legacy dataportuaria.ar.', now()
)
on conflict (dominio_norm) do update
set nombre = excluded.nombre,
    pais = coalesce(public.medios_catalogo.pais, excluded.pais),
    estado = 'activo',
    updated_at = now();

update public.medios
set dominio = 'dataportuaria.com',
    url_feed = 'https://dataportuaria.com/sitemap/0.xml',
    metodo = 'sitemap',
    updated_at = now()
where client_id = (select id from public.clients where slug = 'msd')
  and lower(regexp_replace(regexp_replace(regexp_replace(trim(dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) = 'dataportuaria.ar';

update public.medios_fuentes
set dominio_norm = 'dataportuaria.com',
    activa = true,
    formato = 'sitemap',
    url_feed = 'https://dataportuaria.com/sitemap/0.xml',
    metodo_extraccion = 'feed',
    transporte = 'cloudflare',
    updated_at = now()
where dominio_norm = 'dataportuaria.ar'
  and lower(coalesce(seccion, '')) = 'portada';

insert into public.medios_estrategia (
  dominio_norm, formato, transporte, url_recurso, metodo_extraccion,
  funciona_desde, ultimo_diagnostico, updated_at
)
values (
  'dataportuaria.com', 'sitemap', 'cloudflare',
  'https://dataportuaria.com/sitemap/0.xml', 'feed',
  now(), 'ok', now()
)
on conflict (dominio_norm) do update
set formato = excluded.formato,
    transporte = excluded.transporte,
    url_recurso = excluded.url_recurso,
    metodo_extraccion = excluded.metodo_extraccion,
    updated_at = now();

-- Las dos fuentes son monitoreadas de MSD. La fila se crea solo si no existia;
-- una eventual baja editorial preexistente no se pisa.
insert into public.medios_suscripcion (
  client_id, fuente_id, tier, prioritario, origen, vigente_desde, updated_at
)
select c.id, f.id, null, true, 'manual_legacy', public.v4_hoy(), now()
from public.clients c
join public.medios_fuentes f on f.dominio_norm in ('ciap.org.ar', 'dataportuaria.com') and f.activa
where c.slug = 'msd'
  and not exists (
    select 1 from public.medios_suscripcion s where s.client_id = c.id and s.fuente_id = f.id
  )
on conflict (client_id, fuente_id) do nothing;

-- El rescate sin keyword literal se extiende a fuentes con tier. Estas notas
-- siguen pasando por fecha, pais, desambiguacion y no_entra_nunca antes de A1;
-- no se vuelven forzadas y A2 conserva el descarte editorial.
do $tier_rescate$
declare
  definicion text;
  ancla text := $ancla$    c.alerta_id,
    exists (
      select 1
      from public.medios_suscripcion s$ancla$;
  reemplazo text := $reemplazo$    c.alerta_id,
    exists (
      select 1
      from public.medios_suscripcion s
      where s.client_id = p_client_id
        and s.fuente_id = c.fuente_id
        and s.tier is not null
        and coalesce(s.bloqueado, false) = false
    ) as fuente_tier,
    exists (
      select 1
      from public.medios_suscripcion s$reemplazo$;
  filtro_viejo text := $filtro$where a.fuente_monitoreada
   or a.tiene_marca_titulo$filtro$;
  filtro_nuevo text := $filtro$where a.fuente_monitoreada
   or a.fuente_tier
   or a.tiene_marca_titulo$filtro$;
begin
  select pg_get_functiondef(
    'public.v4_candidatas_aceptadas_operativo(uuid,date,boolean)'::regprocedure
  ) into definicion;

  if position(ancla in definicion) = 0 or position(filtro_viejo in definicion) = 0 then
    raise exception 'No coincide el filtro operativo esperado; se aborta para no ampliar el rescate a ciegas.';
  end if;

  definicion := replace(definicion, ancla, reemplazo);
  execute replace(definicion, filtro_viejo, filtro_nuevo);
end;
$tier_rescate$;

comment on function public.v4_candidatas_aceptadas_operativo(uuid, date, boolean) is
  'Pool operativo: fuentes monitoreadas o con tier llegan a A2 sin keyword literal; las compuertas duras y el juez editorial se conservan.';
