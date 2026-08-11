-- Los 4 clientes de prueba se llamaban "<Cliente> (Test Interno)". El nombre confundia:
-- se leia como "el entorno de prueba de la config", cuando en realidad la version nueva del
-- clipping LEE la config del cliente real (los 4 workflows v3 llaman
-- get_config_clipping con p_slug 'booking'|'bms'|'mars'|'msd') y solo ESCRIBE sus resultados
-- en el *-test. Pasan a llamarse "<Cliente> - Version Nueva", que es lo que representan en
-- las pantallas donde si aparecen (Panel PM, Actividad, Historial).
--
-- Idempotente: el where lo deja sin efecto si ya se aplico.

update clients
set nombre = replace(nombre, ' (Test Interno)', ' - Versión Nueva')
where slug like '%-test' and nombre like '%(Test Interno)%';
