-- Los adicionales activos sin tier se recolectan en el barrido diario; deben
-- poder llegar tambien a la seleccion del cliente (sujeta a sus keywords y
-- reglas, como cualquier otro medio suscripto).
do $migracion$
declare
  definicion text;
  condicion text := '    and (s.tier is not null or mon.dominio_norm is not null)' || chr(10);
begin
  select pg_get_functiondef('public.v4_candidatas_aceptadas_rapido(uuid,date,boolean)'::regprocedure)
    into definicion;
  if definicion is null or position(condicion in definicion) = 0 then
    raise exception 'No se encontro el filtro de tier/monitoreado esperado; no se reemplaza a ciegas.';
  end if;
  definicion := replace(definicion, condicion, '');
  execute definicion;
end;
$migracion$;

-- A1 puede encontrar la fecha real recien despues de la preseleccion. Esta
-- compuerta final se ejecuta al guardar el veredicto: una nota que A1 fecha
-- fuera de la ventana no puede llegar al clipping, ni en test ni en produccion.
create or replace function public.v4_a1_fecha_en_ventana(
  p_client_id uuid,
  p_fecha date,
  p_fecha_pub timestamptz,
  p_fecha_confiable boolean
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with reglas as (
    select max(valor::int) as ventana_h
    from public.reglas_filtro
    where activa and tipo = 'antiguedad'
      and (client_id is null or client_id = p_client_id)
  ), cfg as (
    select coalesce((select ventana_h from reglas), 24) as ventana_h,
           public.v4_corte_cliente_art(p_client_id, p_fecha) as corte
  )
  select
    -- Si A1 no logro fecha, se conserva la regla existente de primera captura.
    -- Si A1 si encontro fecha, esta debe respetar obligatoriamente el corte.
    not coalesce(p_fecha_confiable, false)
    or p_fecha_pub is null
    or (p_fecha_pub >= (select corte from cfg) - make_interval(hours => (select ventana_h from cfg))
        and p_fecha_pub < (select corte from cfg));
$function$;

create or replace function public.v4_trigger_fecha_a1_publica()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.entra
     and not public.v4_a1_fecha_en_ventana(new.client_id, new.fecha, new.fecha_pub, new.fecha_confiable) then
    new.entra := false;
    new.seccion := null;
    new.confianza := null;
    new.forzada := false;
    new.motivo_forzada := 'A1 recupero una fecha fuera de la ventana del clipping';
    new.agente := 'a1_fecha_fuera_de_ventana';
  end if;
  return new;
end;
$function$;

create or replace function public.v4_trigger_fecha_a1_test()
returns trigger
language plpgsql
security definer
set search_path to 'test', 'public'
as $function$
declare
  v_client_id uuid;
  v_fecha date;
begin
  select client_id, fecha into v_client_id, v_fecha
  from test.v4_pipeline_runs
  where id = new.run_id;

  if new.entra and v_client_id is not null
     and not public.v4_a1_fecha_en_ventana(v_client_id, v_fecha, new.fecha_pub, new.fecha_confiable) then
    new.entra := false;
    new.seccion := null;
    new.confianza := null;
    new.forzada := false;
    new.motivo_forzada := 'A1 recupero una fecha fuera de la ventana del clipping';
    new.agente := 'a1_fecha_fuera_de_ventana';
  end if;
  return new;
end;
$function$;

drop trigger if exists v4_fecha_a1_final on public.candidatas_veredicto;
create trigger v4_fecha_a1_final
before insert or update of entra, fecha_pub, fecha_confiable
on public.candidatas_veredicto
for each row execute function public.v4_trigger_fecha_a1_publica();

drop trigger if exists v4_fecha_a1_final on test.v4_candidatas_veredicto;
create trigger v4_fecha_a1_final
before insert or update of entra, fecha_pub, fecha_confiable
on test.v4_candidatas_veredicto
for each row execute function public.v4_trigger_fecha_a1_test();

grant execute on function public.v4_a1_fecha_en_ventana(uuid,date,timestamptz,boolean)
  to anon, authenticated, service_role;
