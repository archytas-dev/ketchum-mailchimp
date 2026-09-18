-- Precarga no se podía usar en public_v4: la RPC v4_test_preload_notes tiene
-- `insert into test.notes_precarga_v4` clavado, sin parámetro de destino. En el plano
-- de Fedra eso habría guardado las notas en el schema `test`, donde la corrida de
-- public_v4 nunca las busca. Por eso estaba bloqueada del lado servidor.
--
-- El problema es que el bloqueo la deja inutilizable justo cuando se necesita: si Fedra
-- precarga hoy una nota para mañana, mañana la v4 tiene que levantarla. Y la levanta de
-- `public.notes_precarga_v4`, porque import_clipping_v4 resuelve el schema por destino:
--   from %I.notes_precarga_v4 p where p.client_id=$3 and p.fecha=$4 and p.consumed_at is null
--
-- Asi que se agrega la version con destino, mismo patron que import_clipping_v4. No es
-- SECURITY DEFINER, igual que la original: se apoya en su propio chequeo de acceso y en
-- la RLS de la tabla, que ya permite `is_staff() OR has_client_access(client_id)`.
--
-- El indice unico parcial (client_id, fecha, norm_url(url)) where consumed_at is null
-- existe en los dos schemas, asi que el ON CONFLICT se comporta igual en ambos.
--
-- v4_test_preload_notes se deja intacta: el plano test la sigue usando y no hay motivo
-- para tocar un camino que funciona la noche antes del cutover.

create or replace function public.v4_preload_notes(
  p_client_id uuid,
  p_fecha date,
  p_notes jsonb,
  p_destino text default 'test'
)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_schema text;
  v_count integer;
begin
  if p_client_id is null or p_fecha is null then
    raise exception 'cliente y fecha son obligatorios' using errcode = '22023';
  end if;
  if jsonb_typeof(p_notes) <> 'array' then
    raise exception 'p_notes debe ser un arreglo' using errcode = '22023';
  end if;
  if p_destino is null or p_destino not in ('test', 'public_v4') then
    raise exception 'destino no permitido: %', p_destino using errcode = 'invalid_parameter_value';
  end if;
  if not (public.is_staff() or public.has_client_access(p_client_id)) then
    raise exception 'sin acceso al cliente' using errcode = '42501';
  end if;

  v_schema := case when p_destino = 'test' then 'test' else 'public' end;

  execute format($q$
    insert into %I.notes_precarga_v4
      (client_id, fecha, seccion, medio, titulo, snippet, url, pub_date, orden,
       dominio, tier, alcance, ad_value)
    select
      $1, $2,
      coalesce(nullif(n->>'seccion', ''), 'Notas Exclusivas'),
      coalesce(v.nombre, nullif(n->>'medio', '')),
      nullif(n->>'titulo', ''), nullif(n->>'snippet', ''),
      nullif(n->>'url', ''), nullif(n->>'pub_date', '')::date,
      coalesce(nullif(n->>'orden', '')::integer, 0),
      v.dominio_norm, v.tier, v.alcance, v.ad_value
    from jsonb_array_elements($3) as n
    left join lateral public.v4_resolver_valorizacion($1, n->>'url', n->>'medio') v on true
    where nullif(n->>'titulo', '') is not null
      and nullif(n->>'url', '') is not null
    on conflict (client_id, fecha, public.norm_url(url)) where consumed_at is null
    do update set
      seccion = excluded.seccion, medio = excluded.medio, titulo = excluded.titulo,
      snippet = excluded.snippet, pub_date = excluded.pub_date, orden = excluded.orden,
      dominio = excluded.dominio, tier = excluded.tier, alcance = excluded.alcance,
      ad_value = excluded.ad_value
  $q$, v_schema) using p_client_id, p_fecha, p_notes;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

grant execute on function public.v4_preload_notes(uuid, date, jsonb, text) to authenticated;
