-- El "+" de "Casi entraron · último filtro" (sumar una nota aprobada por el juez que quedó
-- afuera) no funcionaba en public_v4, por dos motivos distintos:
--
--   1. v4_test_recuperar_candidata lee y escribe test.v4_pipeline_runs, test.v4_candidatas_traza,
--      test.clippings_v4, test.notes_v4 y test.v4_recuperaciones. En el plano de Fedra la nota
--      habría ido al clipping de test, mientras la pantalla lee el de public: la recuperación
--      "funcionaba" y no aparecía en ningún lado.
--   2. Arranca con `if not public.is_staff() then raise exception ...`, así que un usuario
--      cliente la tenía prohibida de entrada.
--
-- En public_v4 quien opera es el cliente, así que el permiso pasa a medirse contra el cliente
-- de la corrida (is_staff OR has_client_access), no contra el rol. Sigue siendo SECURITY
-- DEFINER y sigue validando que la candidata sea realmente recuperable en esa corrida.
--
-- Ojo con los nombres: las proyecciones públicas no son las mismas tablas en otro schema,
-- tienen otro nombre (v4_pipeline_runs_public, v4_candidatas_traza_public,
-- v4_recuperaciones_public), así que no alcanza con parametrizar el schema.
--
-- v4_test_recuperar_candidata se deja intacta: el plano test la sigue usando.

create or replace function public.v4_recuperar_candidata(
  p_run_id uuid,
  p_candidata_id uuid,
  p_destino text default 'test'
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_runs text; v_traza text; v_clips text; v_notes text; v_recup text;
  v_client_id uuid;
  v_fecha date;
  cand public.candidatas_raw%rowtype;
  v_clip uuid;
  v_orden integer;
  v_seccion text;
  v_flag boolean;
begin
  if p_destino is null or p_destino not in ('test', 'public_v4') then
    raise exception 'destino no permitido: %', p_destino using errcode = 'invalid_parameter_value';
  end if;

  if p_destino = 'test' then
    v_runs  := 'test.v4_pipeline_runs';
    v_traza := 'test.v4_candidatas_traza';
    v_clips := 'test.clippings_v4';
    v_notes := 'test.notes_v4';
    v_recup := 'test.v4_recuperaciones';
  else
    v_runs  := 'public.v4_pipeline_runs_public';
    v_traza := 'public.v4_candidatas_traza_public';
    v_clips := 'public.clippings_v4';
    v_notes := 'public.notes_v4';
    v_recup := 'public.v4_recuperaciones_public';
  end if;

  execute format('select client_id, fecha from %s where id = $1', v_runs)
    using p_run_id into v_client_id, v_fecha;
  if v_client_id is null then
    raise exception 'corrida inexistente' using errcode = '22023';
  end if;

  if not (public.is_staff() or public.has_client_access(v_client_id)) then
    raise exception 'sin acceso al cliente de esta corrida' using errcode = '42501';
  end if;

  execute format($q$
    select exists (
      select 1 from %s t
       where t.run_id = $1 and t.candidata_id = $2
         and ( (t.etapa = 'juez' and t.resultado = 'descarta')
            or (t.etapa = 'auditor' and t.resultado = 'descarta'
                and coalesce((t.detalle->>'recuperable')::boolean, false)) )
    )$q$, v_traza) using p_run_id, p_candidata_id into v_flag;
  if not v_flag then
    raise exception 'la candidata no es recuperable en esta corrida' using errcode = '22023';
  end if;

  select * into cand from public.candidatas_raw where id = p_candidata_id;
  if not found then
    raise exception 'candidata inexistente' using errcode = '22023';
  end if;

  execute format('select id from %s where client_id = $1 and fecha = $2', v_clips)
    using v_client_id, v_fecha into v_clip;
  if v_clip is null then
    raise exception 'todavia no hay clipping guardado para esta corrida' using errcode = '22023';
  end if;

  execute format('select exists (select 1 from %s where run_id = $1 and candidata_id = $2)', v_recup)
    using p_run_id, p_candidata_id into v_flag;
  if v_flag then
    return jsonb_build_object('ok', true, 'clipping_id', v_clip, 'ya_recuperada', true);
  end if;

  v_seccion := case v_client_id
    when '99a7b1e3-2b24-4364-a055-be338bfff34a'::uuid then 'Noticias del Sector'
    when '65170cb4-0646-4602-b5b5-f1b93e6762d4'::uuid then 'Turismo'
    when '9aaa5eb6-d9ed-42f7-9ff1-7aa02363e026'::uuid then 'Salud'
    else 'Noticias de interés' end;

  execute format('select coalesce(max(orden), 0) + 1 from %s where clipping_id = $1', v_notes)
    using v_clip into v_orden;

  -- origen='cliente': import_clipping_v4 sólo borra las de origen='n8n' al rearmar, así que
  -- una nota recuperada a mano sobrevive si la corrida se vuelve a ejecutar.
  execute format($q$
    insert into %s (clipping_id, seccion, medio, titulo, snippet, url, pub_date, orden,
                    incluida, origen, candidata_id, dominio, fecha_confiable)
    values ($1, $2, $3, $4, $5, $6, $7, $8, true, 'cliente', $9, $10, $11)
  $q$, v_notes)
    using v_clip, v_seccion, cand.dominio_norm, cand.titulo, cand.snippet, cand.url,
          cand.fecha_pub::date, v_orden, cand.id, cand.dominio_norm, cand.fecha_confiable;

  execute format('insert into %s (run_id, candidata_id, clipping_id, user_id) values ($1, $2, $3, $4)', v_recup)
    using p_run_id, p_candidata_id, v_clip, auth.uid();

  return jsonb_build_object('ok', true, 'clipping_id', v_clip, 'ya_recuperada', false);
end;
$function$;

grant execute on function public.v4_recuperar_candidata(uuid, uuid, text) to authenticated;
