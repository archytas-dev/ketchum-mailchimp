-- Decision de Adrian (11/08): el cliente tiene que ver las dos versiones de su clipping, la
-- que recibe hoy y la nueva. Hasta ahora los usuarios con rol 'cliente' solo tenian acceso a
-- los clientes reales, asi que en Base de Datos no les aparecia la entrada "- Version Nueva"
-- (la unica editable) y no podian tocar nada.
--
-- A cada usuario cliente se le da acceso al *-test correspondiente a cada cliente que ya tenia.
-- Efecto buscado ademas de Base de Datos: en Historial y Actividad pasa a ver tambien las
-- corridas de la version nueva, etiquetadas como tal.
-- Idempotente.
insert into user_client_access (user_id, client_id)
select uca.user_id, t.id
from user_client_access uca
join clients c on c.id = uca.client_id
join clients t on t.slug = c.slug || '-test'
join profiles p on p.id = uca.user_id and p.rol = 'cliente'
on conflict do nothing;
