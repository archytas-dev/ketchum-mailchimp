-- El poblado copio suscripciones tambien de los 4 clientes "(histórico)" (client_ids v2 muertos).
-- La v4 solo corre para los clientes vivos -> se sacan (99 filas). Los dominios quedan en el
-- catalogo igual. Aplicado a produccion el 2026-09-03. Suscripcion final: 2102, todas de clientes vivos.

delete from medios_suscripcion s
using clients c
where c.id = s.client_id and c.nombre ilike '%(histórico)%';
