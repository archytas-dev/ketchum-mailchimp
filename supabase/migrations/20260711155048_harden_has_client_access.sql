create or replace function public.has_client_access(cid uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from public.user_client_access u
    where u.user_id = auth.uid() and u.client_id = cid
  );
$$;

revoke all on function public.has_client_access(uuid) from public, anon;
grant execute on function public.has_client_access(uuid) to authenticated, service_role;
