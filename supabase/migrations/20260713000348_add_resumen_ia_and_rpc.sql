alter table public.clippings add column if not exists resumen_ia jsonb;

create or replace function public.set_clipping_resumen(p_client_id uuid, p_fecha date, p_resumen jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.clippings (client_id, fecha, resumen_ia)
  values (p_client_id, p_fecha, p_resumen)
  on conflict (client_id, fecha) do update set resumen_ia = excluded.resumen_ia;
end;
$$;

revoke all on function public.set_clipping_resumen(uuid, date, jsonb) from public;
revoke all on function public.set_clipping_resumen(uuid, date, jsonb) from anon;
revoke all on function public.set_clipping_resumen(uuid, date, jsonb) from authenticated;
grant execute on function public.set_clipping_resumen(uuid, date, jsonb) to service_role;
