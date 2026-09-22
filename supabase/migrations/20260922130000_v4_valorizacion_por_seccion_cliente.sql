-- Ajusta dónde se muestran tier, alcance y Ad Value según el criterio acordado.
-- No modifica la valorización canónica por medio ni las tablas legacy de la v3.

-- Booking: únicamente Exclusiva.
update public.secciones s
set muestra_ad_value = false
from public.clients c
where s.client_id = c.id
  and c.slug = 'booking';

update public.secciones s
set muestra_ad_value = true
from public.clients c
where s.client_id = c.id
  and c.slug = 'booking'
  and s.nombre = 'Exclusiva';

-- MSD: únicamente Exclusivas.
update public.secciones s
set muestra_ad_value = false
from public.clients c
where s.client_id = c.id
  and c.slug = 'msd';

update public.secciones s
set muestra_ad_value = true
from public.clients c
where s.client_id = c.id
  and c.slug = 'msd'
  and s.nombre = 'Exclusivas';

-- Mars: las tres subáreas de Exclusivas.
update public.secciones s
set muestra_ad_value = false
from public.clients c
where s.client_id = c.id
  and c.slug = 'mars';

update public.secciones s
set muestra_ad_value = true
from public.clients c
where s.client_id = c.id
  and c.slug = 'mars'
  and s.nombre in ('Corporativo', 'Pet Nutrition', 'Snacking');

-- Limpia snapshots v4 existentes que hayan heredado valorización en una
-- sección que ya no la debe mostrar. La valorización de la v3 queda intacta.
update test.notes_v4 n
set tier = null,
    alcance = null,
    ad_value = null
where (n.tier is not null or n.alcance is not null or n.ad_value is not null)
  and not exists (
    select 1
    from test.clippings_v4 c
    join public.secciones s
      on s.client_id = c.client_id
     and s.nombre = n.seccion
     and s.muestra_ad_value = true
    where c.id = n.clipping_id
  );

update public.notes_v4 n
set tier = null,
    alcance = null,
    ad_value = null
where (n.tier is not null or n.alcance is not null or n.ad_value is not null)
  and not exists (
    select 1
    from public.clippings_v4 c
    join public.secciones s
      on s.client_id = c.client_id
     and s.nombre = n.seccion
     and s.muestra_ad_value = true
    where c.id = n.clipping_id
  );
