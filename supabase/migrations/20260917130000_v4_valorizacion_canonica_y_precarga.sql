-- [W0.24] Valorizacion v4 por cliente + dominio canonico.
-- Nunca escribe tiers/medios legacy: esos datos quedan como puente de lectura
-- mientras se completa la semilla por dominio en migraciones posteriores.

create table if not exists public.v4_valorizaciones_medio (
  client_id uuid not null references public.clients(id) on delete cascade,
  dominio_norm text not null references public.medios_catalogo(dominio_norm) on update cascade,
  tier integer check (tier between 1 and 4),
  ad_value bigint check (ad_value is null or ad_value >= 0),
  alcance bigint check (alcance is null or alcance >= 0),
  origen text not null default 'v4',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, dominio_norm)
);
create index if not exists v4_valorizaciones_medio_dominio_idx
  on public.v4_valorizaciones_medio (dominio_norm);

-- Fotos de valorizacion para una precarga: el valor no depende de que alguien
-- renombre el medio antes de que n8n vuelque la nota al clipping.
alter table test.notes_precarga_v4 add column if not exists dominio text;
alter table test.notes_precarga_v4 add column if not exists tier integer;
alter table test.notes_precarga_v4 add column if not exists alcance bigint;
alter table test.notes_precarga_v4 add column if not exists ad_value bigint;

create or replace function public.v4_dominio_desde_texto(p_text text)
returns text
language sql
immutable
parallel safe
as $fn$
  select nullif(
    regexp_replace(
      split_part(
        split_part(regexp_replace(lower(trim(coalesce(p_text, ''))), '^https?://', '', 'i'), '/', 1),
        '?',
        1
      ),
      '^(www\\.)|(:[0-9]+)$',
      '',
      'g'
    ),
    ''
  )
$fn$;

create or replace function public.v4_medio_key(p_text text)
returns text language sql immutable parallel safe as $fn$
  select regexp_replace(regexp_replace(translate(lower(coalesce(p_text,'')), 'áéíóúüñ', 'aeiouun'), '^https?://', '', 'i'), '(^www\\.|\\.(com|net|org|gob|edu|ar|info|tv|io|co|mx|cl|uy|br|es))+$|[^a-z0-9]+', '', 'g')
$fn$;

create or replace function public.v4_guardar_valorizacion(
  p_client_id uuid, p_dominio_norm text, p_tier integer default null,
  p_ad_value bigint default null, p_alcance bigint default null
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_dominio text := public.v4_dominio_desde_texto(p_dominio_norm);
begin
  if not (public.is_staff() or public.has_client_access(p_client_id)) then raise exception 'sin acceso al cliente' using errcode='42501'; end if;
  if v_dominio is null or not exists(select 1 from medios_catalogo where dominio_norm=v_dominio) then raise exception 'el medio v4 no existe o no tiene un dominio valido' using errcode='22023'; end if;
  if p_tier is not null and p_tier not between 1 and 4 then raise exception 'tier invalido' using errcode='22023'; end if;
  if (p_ad_value is not null and p_ad_value<0) or (p_alcance is not null and p_alcance<0) then raise exception 'alcance y ad value no pueden ser negativos' using errcode='22023'; end if;
  insert into v4_valorizaciones_medio(client_id,dominio_norm,tier,ad_value,alcance,origen,updated_at)
  values(p_client_id,v_dominio,p_tier,p_ad_value,p_alcance,'herramienta_v4',now())
  on conflict(client_id,dominio_norm) do update set tier=excluded.tier,ad_value=excluded.ad_value,alcance=excluded.alcance,origen=excluded.origen,updated_at=now();
  update medios_suscripcion ms set tier=p_tier,updated_at=now() from medios_fuentes mf
  where ms.fuente_id=mf.id and ms.client_id=p_client_id and mf.dominio_norm=v_dominio;
  return jsonb_build_object('ok',true,'dominio_norm',v_dominio);
end;
$fn$;

create or replace function public.v4_agregar_medio(
  p_client_id uuid,p_dominio_norm text,p_nombre text,p_tipo text,p_tier integer default null,p_ad_value bigint default null,p_alcance bigint default null
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_dominio text:=public.v4_dominio_desde_texto(p_dominio_norm); v_fuente uuid; v_tipo text:=lower(trim(coalesce(p_tipo,'')));
begin
  if not (public.is_staff() or public.has_client_access(p_client_id)) then raise exception 'sin acceso al cliente' using errcode='42501'; end if;
  if v_dominio is null or position('.' in v_dominio)=0 then raise exception 'dominio invalido' using errcode='22023'; end if;
  if v_tipo not in ('monitoreado','adicional') then raise exception 'tipo invalido' using errcode='22023'; end if;
  insert into medios_catalogo(dominio_norm,nombre,pais,estado,updated_at) values(v_dominio,nullif(trim(p_nombre),''),'AR','activo',now()) on conflict(dominio_norm) do update set nombre=coalesce(nullif(excluded.nombre,''),medios_catalogo.nombre),updated_at=now();
  select id into v_fuente from medios_fuentes where dominio_norm=v_dominio and seccion='portada' order by created_at limit 1;
  if v_fuente is null then insert into medios_fuentes(dominio_norm,seccion,activa) values(v_dominio,'portada',false) returning id into v_fuente; end if;
  insert into medios_suscripcion(client_id,fuente_id,tier,prioritario,origen,bloqueado,created_by) values(p_client_id,v_fuente,p_tier,v_tipo='monitoreado','cliente',false,auth.uid()) on conflict(client_id,fuente_id) do update set tier=excluded.tier,prioritario=excluded.prioritario,origen='cliente',updated_at=now();
  perform public.v4_guardar_valorizacion(p_client_id,v_dominio,p_tier,p_ad_value,p_alcance);
  return jsonb_build_object('ok',true,'dominio_norm',v_dominio,'fuente_id',v_fuente,'estado',case when exists(select 1 from medios_fuentes where id=v_fuente and activa) then 'activo' else 'pendiente_descubrimiento' end);
end;
$fn$;

revoke all on function public.v4_guardar_valorizacion(uuid,text,integer,bigint,bigint) from public,anon;
revoke all on function public.v4_agregar_medio(uuid,text,text,text,integer,bigint,bigint) from public,anon;
grant execute on function public.v4_guardar_valorizacion(uuid,text,integer,bigint,bigint) to authenticated,service_role;
grant execute on function public.v4_agregar_medio(uuid,text,text,text,integer,bigint,bigint) to authenticated,service_role;
