-- [W0.12] El rename del 24/08, que nunca entró al repo.
--
-- QUÉ PASÓ
-- El 24/08 se dieron vuelta los slugs: el cliente real (que era `*-test`, mostrado como
-- "<Cliente> - Versión Nueva") pasó a tener el slug limpio, y el viejo de la v1/v2 pasó a
-- `*-legado`. `src/lib/clientes.ts` documenta el cambio y todo el código filtra por `-legado`.
--
-- POR QUÉ IMPORTA QUE FALTE
-- La migración se aplicó a producción por fuera del repo. Una base local recién levantada
-- (`npx supabase start` + seed + migraciones) queda con `bms` / `bms-test`, que es el modelo
-- ANTERIOR. Consecuencias medidas:
--   - El código filtra `-legado`, y como `bms-test` no termina en `-legado`, el desplegable
--     local muestra los 8 clientes en vez de 4.
--   - La suite e2e quedó escrita contra ese modelo viejo y por eso no describe lo que hace la
--     app hoy. Arreglar los textos de los tests sin esto daría una suite verde que no prueba
--     nada de producción.
--   - Una fixture que tomó el `client_id` del seed local escribió para `bms-legado` creyendo
--     que era BMS (ver auditoria/paso3, §sobre la guarda de clientes legado).
--
-- IDEMPOTENTE Y SEGURA EN PRODUCCIÓN
-- Sólo hace algo si encuentra la forma vieja (algún slug terminado en `-test`). En producción
-- no existe ninguno, así que es un no-op. Sin esa guarda, correrla contra producción
-- renombraría el cliente REAL a `-legado`, que es exactamente el desastre que hay que evitar.

do $$
begin
  if not exists (select 1 from public.clients where slug like '%-test') then
    raise notice '[rename 24/08] no hay slugs *-test: nada que hacer';
    return;
  end if;

  -- 1) El viejo se va a -legado. Va primero: si no, el paso 2 choca con el unique de slug.
  update public.clients
     set slug   = slug || '-legado',
         nombre = nombre || ' (histórico)'
   where slug in ('bms', 'booking', 'msd', 'mars');

  -- 2) El que era *-test toma el slug y el nombre limpios.
  update public.clients
     set slug   = left(slug, length(slug) - 5),
         nombre = replace(replace(nombre, ' - Versión Nueva', ''), ' (Test Interno)', '')
   where slug like '%-test';

  raise notice '[rename 24/08] aplicado';
end $$;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN — tiene que quedar igual que producción:
--   bms            | BMS                          bms-legado     | BMS (histórico)
--   booking        | Booking                      booking-legado | Booking (histórico)
--   mars           | MARS                         mars-legado    | MARS (histórico)
--   msd            | MSD Salud Animal             msd-legado     | MSD Salud Animal (histórico)
--
--   select slug, nombre from public.clients order by slug;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- SEGUNDA PARTE: la config tiene que colgar del cliente VIVO.
--
-- El rename dio vuelta los slugs pero no movió los datos. En producción la config quedó bajo
-- el cliente vivo (BMS: 744 medios, 11 secciones, 108 keywords; bms-legado: 0 de cada una).
-- En una base local recién levantada pasa lo contrario: todo cuelga del que ahora es `-legado`,
-- así que Base de Datos y Precarga aparecen vacías y 7 tests e2e fallan por dato faltante.
--
-- `tiers` se COPIA en vez de moverse: en producción existe en los dos lados (bms 812 /
-- bms-legado 809), porque se cargó por cliente desde el principio.
--
-- Guarda propia e independiente de la primera: sólo actúa si el cliente vivo está vacío y el
-- legado tiene datos. En producción es no-op.
-- ---------------------------------------------------------------------------

do $$
declare r record; movidas int := 0;
begin
  for r in
    select viv.id as vivo, leg.id as legado, viv.slug
    from public.clients viv
    join public.clients leg on leg.slug = viv.slug || '-legado'
    where viv.slug not like '%-legado'
      and not exists (select 1 from public.medios m where m.client_id = viv.id)
      and     exists (select 1 from public.medios m where m.client_id = leg.id)
  loop
    update public.medios              set client_id = r.vivo where client_id = r.legado;
    update public.secciones           set client_id = r.vivo where client_id = r.legado;
    update public.kw_keywords         set client_id = r.vivo where client_id = r.legado;
    update public.google_alerts       set client_id = r.vivo where client_id = r.legado;
    update public.medios_seguimiento  set client_id = r.vivo where client_id = r.legado;
    update public.gacetillas          set client_id = r.vivo where client_id = r.legado;
    update public.medios_bloqueados   set client_id = r.vivo where client_id = r.legado;

    -- tiers se copia: en produccion vive en los dos.
    insert into public.tiers (client_id, dominio, medio, tier, ad_value, alcance)
    select r.vivo, t.dominio, t.medio, t.tier, t.ad_value, t.alcance
      from public.tiers t where t.client_id = r.legado
    on conflict do nothing;

    movidas := movidas + 1;
    raise notice '[rename 24/08] config movida a %', r.slug;
  end loop;

  if movidas = 0 then
    raise notice '[rename 24/08] config ya esta en el cliente vivo: nada que mover';
  end if;
end $$;
