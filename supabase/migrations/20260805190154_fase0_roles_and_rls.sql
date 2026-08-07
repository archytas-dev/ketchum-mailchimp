-- Funciones de rol
create or replace function current_rol()
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((select rol from profiles where id = auth.uid()), 'cliente');
$$;

create or replace function is_staff()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select current_rol() in ('dev','pm');
$$;

create or replace function is_dev()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select current_rol() = 'dev';
$$;

-- El default actual de profiles.rol es 'editor'; lo alineo al modelo cliente/dev/pm
alter table profiles alter column rol set default 'cliente';

-- Migración de usuarios existentes (TDD §6.2)
insert into profiles (id, nombre, rol)
select 'd344886b-8d20-4475-b4ee-0fad869495d2', 'Fedra Cacciamano', 'cliente'
where exists (select 1 from auth.users u where u.id = 'd344886b-8d20-4475-b4ee-0fad869495d2')  -- [portabilidad] no-op si el usuario no existe (entornos limpios / local)
on conflict (id) do update set rol = 'cliente';

update profiles set rol = 'dev'
where id = 'b005c199-9e42-42e7-a2e0-ebdea7dacd34';

-- Config editable por cliente: kw_keywords, medios, gacetillas, tiers
alter table kw_keywords enable row level security;
create policy kw_keywords_rw on kw_keywords for all
  using (has_client_access(client_id)) with check (has_client_access(client_id));

alter table medios enable row level security;
create policy medios_rw on medios for all
  using (has_client_access(client_id)) with check (has_client_access(client_id));

alter table gacetillas enable row level security;
create policy gacetillas_rw on gacetillas for all
  using (has_client_access(client_id)) with check (has_client_access(client_id));

alter table tiers enable row level security;
create policy tiers_rw on tiers for all
  using (has_client_access(client_id)) with check (has_client_access(client_id));

-- Secciones: cliente ve, staff edita
alter table secciones enable row level security;
create policy secciones_read on secciones for select using (has_client_access(client_id));
create policy secciones_write on secciones for insert with check (is_staff());
create policy secciones_update on secciones for update using (is_staff()) with check (is_staff());
create policy secciones_delete on secciones for delete using (is_staff());

-- Tier defaults: cliente ve (para que el cálculo le cierre), staff edita
alter table tier_defaults enable row level security;
create policy tier_defaults_read on tier_defaults for select using (has_client_access(client_id));
create policy tier_defaults_write on tier_defaults for insert with check (is_staff());
create policy tier_defaults_update on tier_defaults for update using (is_staff()) with check (is_staff());
create policy tier_defaults_delete on tier_defaults for delete using (is_staff());

-- Google Alerts: Dev + PM (decisión de hoy)
alter table google_alerts enable row level security;
create policy google_alerts_staff on google_alerts for all
  using (is_staff()) with check (is_staff());

-- Capturas de gacetilla: cliente lee (vía join a gacetillas), staff escribe
alter table gacetilla_capturas enable row level security;
create policy gacetilla_capturas_read on gacetilla_capturas for select
  using (exists (select 1 from gacetillas g where g.id = gacetilla_capturas.gacetilla_id and has_client_access(g.client_id)));
create policy gacetilla_capturas_write on gacetilla_capturas for insert with check (is_staff());
create policy gacetilla_capturas_update on gacetilla_capturas for update using (is_staff()) with check (is_staff());
create policy gacetilla_capturas_delete on gacetilla_capturas for delete using (is_staff());

-- run_stats: 100% staff-only (decisión de hoy)
alter table run_stats enable row level security;
create policy run_stats_staff on run_stats for all
  using (is_staff()) with check (is_staff());

-- notas_descartadas: cliente lee ("casi entraron"), staff escribe
alter table notas_descartadas enable row level security;
create policy notas_descartadas_read on notas_descartadas for select using (has_client_access(client_id));
create policy notas_descartadas_write on notas_descartadas for insert with check (is_staff());
create policy notas_descartadas_update on notas_descartadas for update using (is_staff()) with check (is_staff());
create policy notas_descartadas_delete on notas_descartadas for delete using (is_staff());

-- medios_bloqueados: cliente lee la lista, staff escribe/gestiona
alter table medios_bloqueados enable row level security;
create policy medios_bloqueados_read on medios_bloqueados for select using (has_client_access(client_id));
create policy medios_bloqueados_write on medios_bloqueados for insert with check (is_staff());
create policy medios_bloqueados_update on medios_bloqueados for update using (is_staff()) with check (is_staff());
create policy medios_bloqueados_delete on medios_bloqueados for delete using (is_staff());

-- url_log: 100% interno (collector de fin de semana), staff-only
alter table url_log enable row level security;
create policy url_log_staff on url_log for all
  using (is_staff()) with check (is_staff());

-- export_metrics: el cliente genera sus propias métricas al exportar
alter table export_metrics enable row level security;
create policy export_metrics_rw on export_metrics for all
  using (has_client_access(client_id)) with check (has_client_access(client_id));

-- config_changelog: solo staff (el trigger que lo alimenta se arma después)
alter table config_changelog enable row level security;
create policy config_changelog_staff_read on config_changelog for select using (is_staff());

-- reportes: cliente escribe/lee lo suyo, staff resuelve
alter table reportes enable row level security;
create policy reportes_select on reportes for select using (has_client_access(client_id));
create policy reportes_insert on reportes for insert with check (has_client_access(client_id));
create policy reportes_update on reportes for update using (is_staff()) with check (is_staff());
create policy reportes_delete on reportes for delete using (is_staff());

