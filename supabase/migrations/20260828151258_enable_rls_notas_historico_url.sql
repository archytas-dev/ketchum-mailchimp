alter table public.notas_historico_url enable row level security;

create policy notas_historico_url_staff on public.notas_historico_url
  for all
  using (is_staff())
  with check (is_staff());
