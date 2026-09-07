create table public.medios_bloqueados_global (
  id uuid primary key default gen_random_uuid(),
  dominio text not null,
  motivo text,
  notas text,
  agregado_por text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index medios_bloqueados_global_dominio_uk on public.medios_bloqueados_global (lower(dominio));

alter table public.medios_bloqueados_global enable row level security;

-- Solo staff administra esta lista (mismo criterio que run_stats/url_log/config_changelog).
create policy "staff_all_medios_bloqueados_global"
  on public.medios_bloqueados_global for all
  using (is_staff())
  with check (is_staff());

grant select on public.medios_bloqueados_global to service_role;
grant all on public.medios_bloqueados_global to service_role;
