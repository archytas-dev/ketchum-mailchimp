-- [F4.1] url_canonica v2: desenvolver el redirector base64 del agregador.
--
-- Por qué importa, medido el 04/09: el historial anti-repetición tiene 9.806 filas y
-- 5.243 (53%) son URLs de redirector crudas. Una URL de redirector NUNCA vuelve a
-- matchear la real, así que esas notas se pueden re-enviar para siempre — es la mitad
-- del reporte "nota vieja o repetida".
--
-- El caso ?url= / ?q= ya lo resolvía la v1. Faltaba el otro formato:
--   news.google.com/rss/articles/CBMiK2h0dHBz...  <- base64 url-safe con la URL adentro
--
-- Ojo con el pool nuevo: hoy tiene CERO URLs de agregador (la v4 va directo al feed de
-- cada medio), así que este cambio no altera ningún valor ya calculado de
-- candidatas_raw.url_canonica. Sirve para limpiar el historial que hereda la v4.

create or replace function public.url_canonica(u text)
returns text language sql immutable set search_path = public as $$
  with raw as (select btrim(coalesce(u,'')) as u),
  -- 1. Redirector con la URL en un parámetro: ?url= o ?q=
  unwrapped as (
    select coalesce((regexp_match(r.u, '[?&](?:url|q)=(https?(?:://|%3[aA]%2[fF]%2[fF])[^&]+)'))[1], r.u) as u
    from raw r
  ),
  -- 2. Redirector del agregador con la URL en base64 url-safe.
  --    Se decodifica a LATIN1 y no a UTF8 a propósito: el contenido es protobuf con
  --    bytes que no son texto válido, y convert_from(...,'UTF8') aborta con error.
  --    LATIN1 acepta cualquier byte, y la URL sale igual porque es ASCII.
  b64 as (
    select u.u,
      (regexp_match(u.u, 'news\.google\.com/(?:rss/)?articles/([A-Za-z0-9_-]{16,})'))[1] as tok
    from unwrapped u
  ),
  desagregado as (
    select case
      when b.tok is null then b.u
      else coalesce(
        (regexp_match(
           convert_from(
             decode(translate(b.tok,'-_','+/') || repeat('=', (4 - length(b.tok) % 4) % 4), 'base64'),
             'LATIN1'),
           'https?://[^\s"<>\\]+'))[1],
        b.u)   -- si no se puede decodificar, se deja la original: nunca se inventa una URL
    end as u
    from b64 b
  ),
  decoded as (
    select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
             d.u, '%3[aA]', ':', 'g'), '%2[fF]', '/', 'g'), '%3[fF]', '?', 'g'),
             '%3[dD]', '=', 'g'), '%26', '&', 'g'), '%3[bB]', ';', 'g') as u
    from desagregado d
  ),
  bare as (select regexp_replace(regexp_replace(d.u, '^https?://', ''), '^www\.', '') as u from decoded d),
  notrack as (
    select regexp_replace(regexp_replace(regexp_replace(b.u,
             '([?&])(utm_[^=&]*|fbclid|gclid|_ga|ref|origin|mc_[^=&]*|igshid|spm|oc)=[^&]*', '\1', 'g'),
           '&&+', '&', 'g'), '\?&+', '?', 'g') as u
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
$$;

comment on function public.url_canonica(text) is
  'Forma única de una URL: desenvuelve los dos formatos de redirector del agregador (?url=/?q= y el token base64 de news.google.com), saca tracking conservando el id del artículo, y normaliza esquema, www, barra final y mayúsculas del host. IMMUTABLE — se usa en la columna generada candidatas_raw.url_canonica y en el índice de dedup. Si el base64 no se puede decodificar devuelve la URL original: nunca inventa una.';
