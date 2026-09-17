-- La valorización v4 se consulta desde Server Actions autenticadas. Nunca se
-- expone por la anon key ni queda abierta por vivir en schema public.

alter table public.v4_valorizaciones_medio enable row level security;
alter table public.v4_valorizaciones_medio force row level security;

drop policy if exists v4_valorizaciones_medio_lectura on public.v4_valorizaciones_medio;
create policy v4_valorizaciones_medio_lectura
  on public.v4_valorizaciones_medio
  for select to authenticated
  using (public.is_staff() or public.has_client_access(client_id));

revoke all on public.v4_valorizaciones_medio from public, anon;
grant select on public.v4_valorizaciones_medio to authenticated;
grant all on public.v4_valorizaciones_medio to service_role;
