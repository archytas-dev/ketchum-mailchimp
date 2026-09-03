-- Pipeline v4 · fija search_path en las funciones puras (advisor: function_search_path_mutable).
-- Mismo cuerpo que 20260903174914, solo se agrega `set search_path to 'public'`
-- (estilo de fase0_rpcs). Aplicado a produccion el 2026-09-03.

create or replace function tier_norm(s text) returns text
language sql immutable set search_path to 'public' as $fn$
  select nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(translate(coalesce(s,''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
          '\.com(\.ar)?\y', '', 'g'),
        '^(el|la|los|las)\s+', ''),
      '\s+', ' ', 'g')
  ), '');
$fn$;

create or replace function url_canonica(u text) returns text
language sql immutable set search_path to 'public' as $fn$
  with raw as (select btrim(coalesce(u,'')) as u),
  unwrapped as (
    select coalesce((regexp_match(r.u, '[?&](?:url|q)=(https?(?:://|%3[aA]%2[fF]%2[fF])[^&]+)'))[1], r.u) as u
    from raw r
  ),
  decoded as (
    select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
             u.u, '%3[aA]', ':', 'g'), '%2[fF]', '/', 'g'), '%3[fF]', '?', 'g'),
             '%3[dD]', '=', 'g'), '%26', '&', 'g'), '%3[bB]', ';', 'g') as u
    from unwrapped u
  ),
  bare as (select regexp_replace(regexp_replace(d.u, '^https?://', ''), '^www\.', '') as u from decoded d),
  notrack as (
    select regexp_replace(
             regexp_replace(
               regexp_replace(b.u,
                 '([?&])(utm_[^=&]*|fbclid|gclid|_ga|ref|origin|mc_[^=&]*|igshid|spm)=[^&]*', '\1', 'g'),
             '&&+', '&', 'g'),
           '\?&+', '?', 'g') as u
    from bare b
  ),
  cleaned as (
    select regexp_replace(regexp_replace(regexp_replace(nt.u, '#.*$', ''), '[?&]+$', ''), '/+$', '') as u
    from notrack nt
  ),
  hostlower as (
    select lower(substring(c.u from '^[^/?]+')) || coalesce(substring(c.u from '([/?].*)$'), '') as u
    from cleaned c
  )
  select nullif(u, '') from hostlower;
$fn$;

create or replace function resolver_fecha(p_cands jsonb)
returns jsonb language plpgsql stable set search_path to 'public' as $fn$
declare
  v_txt text; v_ts timestamptz; v_m text[];
begin
  foreach v_txt in array array['feed','json_ld','og'] loop
    if (p_cands ? v_txt) and nullif(p_cands->>v_txt, '') is not null then
      begin
        v_ts := (p_cands->>v_txt)::timestamptz;
        return jsonb_build_object('fecha', v_ts, 'origen', v_txt, 'confiable', true);
      exception when others then null;
      end;
    end if;
  end loop;
  if nullif(p_cands->>'url', '') is not null then
    v_m := regexp_match(p_cands->>'url', '/((?:19|20)\d{2})[/-](\d{1,2})(?:[/-](\d{1,2}))?');
    if v_m is not null then
      begin
        v_ts := make_date(v_m[1]::int, v_m[2]::int, coalesce(v_m[3], '1')::int);
        return jsonb_build_object('fecha', v_ts, 'origen', 'url', 'confiable', true);
      exception when others then null;
      end;
    end if;
  end if;
  return jsonb_build_object('fecha', null, 'origen', 'sin_fecha', 'confiable', false);
end;
$fn$;
