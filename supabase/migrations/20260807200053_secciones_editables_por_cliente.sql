-- KET-45: el cliente (Fedra / equipo Ketchum) tiene que poder crear secciones nuevas
-- desde la pestania "Base de Datos". Decision de Adrian, 07/08/2026.
--
-- El 05/08 las secciones habian quedado staff-only (solo Archytas). Se abre el alta y la
-- reordenacion al cliente, pero NO el borrado, y el renombre queda restringido desde la app.
--
-- Por que no borrado ni renombre libre: el nombre de la seccion es la clave con la que el
-- flujo de n8n matchea a que bloque del mail va cada nota (Build HTML Email + el mapa de
-- keyword->grupo). Renombrar o borrar una seccion existente deja notas sin destino y el
-- bloque sale vacio o desaparece del clipping. Crear una seccion nueva, en cambio, no rompe
-- nada de lo que ya funciona: en el peor caso queda vacia hasta que se le apunte una keyword
-- (la UI avisa cuando una seccion tiene 0 keywords).

drop policy if exists secciones_write on secciones;
drop policy if exists secciones_update on secciones;

-- Alta: el cliente puede crear secciones para sus propios clientes.
create policy secciones_write on secciones for insert
  with check (has_client_access(client_id));

-- Edicion: habilitada para el cliente (orden, activa, alias). El renombre de secciones
-- preexistentes se bloquea en la capa de aplicacion, no aca: RLS no distingue por columna.
create policy secciones_update on secciones for update
  using (has_client_access(client_id))
  with check (has_client_access(client_id));

-- Borrado: sigue siendo staff-only (secciones_delete queda como estaba).
