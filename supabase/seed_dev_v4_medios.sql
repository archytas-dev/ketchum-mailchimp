-- Catálogo v4 mínimo para desarrollo local.
--
-- `medios_catalogo` / `medios_fuentes` / `medios_suscripcion` / `v4_valorizaciones_medio`
-- existen por migración pero se poblaron a mano en el proyecto remoto de Ketchum (Fase 1,
-- 03/09) -- ese poblado nunca se capturó en el repo, así que una base local recién levantada
-- los deja vacíos. Sin esto, Base de Datos en el plano v4 no tiene nada que mostrar para
-- NINGÚN cliente, sin importar el cliente elegido.
--
-- "Clarin" coincide a propósito con el medio de la nota `clipping_v4_bms_v1.json` (fixture
-- canónica de `import_clipping_v4`), para que el mismo dominio aparezca tanto en el clipping
-- de /hoy como en Base de Datos.

insert into public.medios_catalogo (dominio_norm, nombre, pais, estado)
values ('clarin.com', 'Clarin', 'AR', 'activo')
on conflict (dominio_norm) do nothing;

insert into public.medios_fuentes (id, dominio_norm, seccion, formato, activa, metodo_extraccion)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'clarin.com', 'portada', 'rss', true, 'feed')
on conflict (id) do nothing;

-- client_id 99a7b1e3... es el BMS de producción (mismo que usa la fixture v4, ver su propio
-- comentario "OJO: client_id es el BMS de PRODUCCION"). Local lo tiene bajo el slug `bms-test`
-- por el drift de rename documentado en 20260824120000_rename_clientes_test_a_legado.sql.
insert into public.medios_suscripcion (client_id, fuente_id, tier, prioritario, origen)
values ('99a7b1e3-2b24-4364-a055-be338bfff34a', 'aaaaaaaa-0000-4000-8000-000000000001', 1, true, 'cliente')
on conflict (client_id, fuente_id) do nothing;

insert into public.v4_valorizaciones_medio (client_id, dominio_norm, tier, ad_value, alcance, origen)
values ('99a7b1e3-2b24-4364-a055-be338bfff34a', 'clarin.com', 1, 500000, 1000000, 'v4')
on conflict (client_id, dominio_norm) do nothing;
