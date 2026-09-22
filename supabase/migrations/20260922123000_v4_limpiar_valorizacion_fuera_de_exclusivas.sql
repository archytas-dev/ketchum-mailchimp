-- Limpia snapshots v4 ya guardados con la regla anterior.
-- La valorizacion canonica por medio no se toca: solo se eliminan copias de
-- tier/alcance/ad_value de notas que pertenecen a secciones que no los muestran.
-- No modifica las tablas legacy de la v3.

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
