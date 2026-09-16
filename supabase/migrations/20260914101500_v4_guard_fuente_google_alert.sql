-- Correccion del guard de separacion: las candidatas de Google Alerts pueden
-- no tener fuente_id; su pertenencia se valida exclusivamente por alerta_id.
create or replace function public.v4_guardar_candidata_del_cliente()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'test'
as $function$
declare
  v_client_id uuid;
  v_fuente_id uuid;
  v_alerta_id uuid;
  v_permitida boolean := false;
begin
  if TG_TABLE_SCHEMA = 'test' then
    select r.client_id into v_client_id
    from test.v4_pipeline_runs r
    where r.id = new.run_id;
  else
    select r.client_id into v_client_id
    from public.pipeline_runs r
    where r.id = new.run_id;
  end if;

  select c.fuente_id, c.alerta_id
    into v_fuente_id, v_alerta_id
  from public.candidatas_raw c
  where c.id = new.candidata_id;

  if v_client_id is null or (v_fuente_id is null and v_alerta_id is null) then
    raise exception 'No se puede asociar la candidata % con un cliente/fuente o alerta valido', new.candidata_id
      using errcode = '22023';
  end if;

  if v_alerta_id is not null then
    select exists (
      select 1
      from public.google_alerts ga
      where ga.id = v_alerta_id
        and ga.client_id = v_client_id
        and ga.activa
    ) into v_permitida;
  else
    select exists (
      select 1
      from public.medios_suscripcion s
      join public.medios_fuentes f
        on f.id = s.fuente_id
       and f.activa
      where s.client_id = v_client_id
        and s.fuente_id = v_fuente_id
        and coalesce(s.bloqueado, false) = false
    ) into v_permitida;
  end if;

  if not v_permitida then
    raise exception 'La candidata % no pertenece a una fuente activa del cliente de la corrida', new.candidata_id
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.v4_guardar_candidata_del_cliente() is
  'Protege el pool por cliente: fuente suscripta o Google Alert activa del mismo cliente.';
