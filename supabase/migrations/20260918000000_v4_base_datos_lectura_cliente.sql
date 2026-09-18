-- Base de Datos aparecía completamente vacía para un usuario cliente en el plano
-- public_v4 (cuenta de Fedra), y bien para staff.
--
-- Causa, la misma clase de bug que "Nota sin título" en Actividad: la rama v4 de
-- listMedios() arranca en medios_suscripcion (RLS `has_client_access`, la lee), saca
-- los fuente_id y después consulta medios_fuentes y medios_catalogo, que tienen RLS
-- `using (is_staff())`. Un cliente recibe [] SIN error, así que el `for` no itera y
-- la función devuelve data: [] -- tabla vacía y ningún mensaje que explique por qué.
--
-- En v3 el equivalente (public.medios) siempre fue `has_client_access(client_id)`: el
-- cliente ve sus propios medios. Esto es una regresión del plano v4, no una decisión.
--
-- Se agregan policies SOLO de lectura y SOLO sobre lo que el cliente ya tiene
-- suscripto. Las policies existentes son FOR ALL y las permisivas se combinan con OR,
-- así que staff no cambia y la escritura sigue siendo staff-only -- que es justo lo
-- que la pantalla espera en v4 ("config compartida de solo lectura").
--
-- Los helpers van SECURITY DEFINER para no evaluar la RLS de medios_suscripcion
-- dentro de la policy de otra tabla (sería lento y frágil). auth.uid() se conserva
-- bajo SECURITY DEFINER, así que has_client_access sigue midiendo al usuario real.

create or replace function public.v4_cliente_ve_fuente(p_fuente_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.medios_suscripcion s
     where s.fuente_id = p_fuente_id
       and public.has_client_access(s.client_id)
  );
$function$;

create or replace function public.v4_cliente_ve_dominio(p_dominio text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.medios_suscripcion s
      join public.medios_fuentes f on f.id = s.fuente_id
     where f.dominio_norm = p_dominio
       and public.has_client_access(s.client_id)
  );
$function$;

-- medios_suscripcion sólo tiene índice por (client_id, fuente_id); estos helpers
-- buscan por fuente_id suelto, que sin esto es un recorrido completo.
create index if not exists medios_suscripcion_fuente_idx
  on public.medios_suscripcion (fuente_id);

drop policy if exists medios_fuentes_lectura_cliente on public.medios_fuentes;
create policy medios_fuentes_lectura_cliente
  on public.medios_fuentes
  for select
  using (public.v4_cliente_ve_fuente(id));

drop policy if exists medios_catalogo_lectura_cliente on public.medios_catalogo;
create policy medios_catalogo_lectura_cliente
  on public.medios_catalogo
  for select
  using (public.v4_cliente_ve_dominio(dominio_norm));
