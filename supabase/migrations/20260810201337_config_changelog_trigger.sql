-- TDD §11.1: "Cliente suma config nueva" -> App inserta en medios/kw_keywords -> trigger
-- -> config_changelog (notificado=false) -> un workflow n8n ("Config Watcher", pendiente
-- de armar, requiere el MCP de n8n que se desconecto en esta sesion) agrupa y avisa a Slack.
--
-- Filtro importante: SOLO loguea cambios hechos por un usuario CLIENTE autenticado via la
-- app. Dos casos que hay que excluir a proposito:
--   1. auth.uid() is null -> la escritura vino de n8n con la service_role key (auto-discovery
--      de medios, Update Metodo Sitios, etc). Es trafico de pipeline normal, no una accion de
--      Fedra -- alertarlo seria ruido constante sin valor.
--   2. is_staff() -> un dev/pm edito desde la app. Ya sabe lo que cambio, no necesita que le
--      avisen a si mismo.
-- current_rol() resuelve a 'cliente' por default cuando auth.uid() es null (coalesce), por eso
-- NO alcanza con chequear is_staff() solo -- hay que chequear auth.uid() explicitamente o el
-- trafico de n8n quedaria mal clasificado como "cliente" y generaria alertas falsas.
create or replace function log_config_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_client_id uuid;
begin
  if auth.uid() is null or is_staff() then
    return coalesce(new, old);
  end if;

  v_client_id := coalesce(new.client_id, old.client_id);

  insert into config_changelog (client_id, user_id, tabla, registro_id, accion, antes, despues)
  values (
    v_client_id,
    auth.uid(),
    tg_table_name,
    coalesce(new.id, old.id),
    case tg_op when 'INSERT' then 'alta' when 'DELETE' then 'baja' else 'edicion' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

-- Alcance ampliado (pedido explícito de Adrián 10/08): "todo lo que hizo Fedra", no solo
-- medios/keywords. Cubre las 4 tablas de config "editable por cliente" del TDD (medios,
-- kw_keywords, gacetillas, tiers) + notes_precarga (agregar una nota al clipping del día
-- no es "config" en el sentido del TDD, pero Adrián lo quiere en el mismo aviso diario).
create trigger medios_changelog
  after insert or update or delete on medios
  for each row execute function log_config_change();

create trigger kw_keywords_changelog
  after insert or update or delete on kw_keywords
  for each row execute function log_config_change();

create trigger gacetillas_changelog
  after insert or update or delete on gacetillas
  for each row execute function log_config_change();

create trigger tiers_changelog
  after insert or update or delete on tiers
  for each row execute function log_config_change();

create trigger notes_precarga_changelog
  after insert or update or delete on notes_precarga
  for each row execute function log_config_change();
