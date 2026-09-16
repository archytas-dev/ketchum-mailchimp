-- Lookup con el mismo normalizador que usan los templates v3 para mostrar
-- Tier, Alcance y Ad Value junto al medio en el email.
create or replace function public.v4_email_tier_norm(s text)
returns text language sql immutable set search_path to 'public' as $fn$
  select btrim(regexp_replace(
    regexp_replace(
      lower(translate(coalesce(s,''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
      '[^a-z0-9 ]', ' ', 'g'
    ),
    '\y(online|web|com|ar|digital|diario|portal|noticias|el|la|los|las)\y', ' ', 'g'
  ));
$fn$;

create or replace function public.v4_email_tier_lookup(p_client_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  select jsonb_build_object('lookup', coalesce(jsonb_object_agg(clave, dato), '{}'::jsonb))
  from (
    select v4_email_tier_norm(t.medio) as clave,
      jsonb_build_object('tier', t.tier, 'alcance', t.alcance, 'ad_value', t.ad_value) as dato
    from tiers t
    where t.client_id = p_client_id and t.medio is not null
  ) x
  where clave <> '';
$fn$;

grant execute on function public.v4_email_tier_lookup(uuid) to anon, authenticated, service_role;
