-- Ajustes del corte 2026-09-11:
-- * El rescate de fuentes monitoreadas es una excepción editorial de BMS.
--   Los otros tres clientes conservan el filtro de keywords que ya tenían.
-- * La deduplicación pasa a ser entre medios, no solo dentro del mismo dominio.
-- * El armado vuelve a deduplicar como red de seguridad, tanto en producción
--   como en las corridas aisladas de test.
-- COVID queda deliberadamente fuera de esta migración.

do $scope$
declare
  definicion text;
begin
  select pg_get_functiondef(
    'public.v4_candidatas_aceptadas_operativo(uuid,date,boolean)'::regprocedure
  ) into definicion;

  if position('((select slug from cliente) = ''bms'' and a.fuente_monitoreada)' in definicion) = 0 then
    if position('where a.fuente_monitoreada' in definicion) = 0 then
      raise exception 'No coincide el filtro operativo; no se modifica a ciegas.';
    end if;
    definicion := replace(
      definicion,
      'where a.fuente_monitoreada',
      'where ((select slug from cliente) = ''bms'' and a.fuente_monitoreada)'
    );
    execute definicion;
  end if;
end;
$scope$;

do $rapid$
declare
  definicion text;
  viejo text := 'partition by p.dominio_norm, lower(regexp_replace(coalesce(p.titulo, ''''), ''[^a-zA-Z0-9]+'', '''', ''g''))';
  nuevo text := E'partition by case\n      when nullif(public.v4_keyword_norm(coalesce(p.titulo, '''')), '''') is not null\n        then public.v4_keyword_norm(coalesce(p.titulo, ''''))\n      when nullif(p.url_canonica, '''') is not null\n        then ''url:'' || lower(regexp_replace(p.url_canonica, ''[?#].*$'', '''', ''g''))\n      else ''id:'' || p.id::text\n    end';
begin
  select pg_get_functiondef(
    'public.v4_candidatas_aceptadas_rapido(uuid,date,boolean)'::regprocedure
  ) into definicion;

  if position('then public.v4_keyword_norm(coalesce(p.titulo' in definicion) = 0 then
    if position(viejo in definicion) = 0 then
      raise exception 'No coincide la deduplicación rápida; no se modifica a ciegas.';
    end if;
    execute replace(definicion, viejo, nuevo);
  end if;
end;
$rapid$;

-- El armado aplica una última deduplicación por título/URL. Se conserva la
-- versión más útil: forzada, valorizada, mayor confianza y más reciente.
do $clip$
declare
  definicion text;
  inyeccion text := $cte$), notas_ranked as (
  select n.*,
    row_number() over (
      partition by coalesce(
        nullif(public.v4_keyword_norm(coalesce(n.titulo, '')), ''),
        case
          when nullif(n.url, '') is not null
            then 'url:' || lower(regexp_replace(n.url, '[?#].*$', '', 'g'))
          else 'id:' || n.candidata_id::text
        end
      )
      order by n.forzada desc,
        (n.tier is not null) desc,
        n.tier asc nulls last,
        n.confianza desc nulls last,
        n.ad_value desc nulls last,
        n.fecha_pub desc nulls last,
        n.candidata_id
    ) as rn
  from notas n
), notas_unicas as (
  select * from notas_ranked where rn = 1$cte$;
begin
  select pg_get_functiondef(
    'public.armar_clipping(uuid,date,text)'::regprocedure
  ) into definicion;
  if position('notas_ranked as' in definicion) = 0 then
    if position('), por_seccion as (' in definicion) = 0 then
      raise exception 'No coincide el armado productivo; no se modifica a ciegas.';
    end if;
    definicion := replace(definicion, '), por_seccion as (', inyeccion || '), por_seccion as (');
    definicion := replace(definicion, 'left join notas n', 'left join notas_unicas n');
    definicion := replace(definicion, '(select count(*) from notas)', '(select count(*) from notas_unicas)');
    definicion := replace(definicion, '(select coalesce(sum(ad_value), 0) from notas)', '(select coalesce(sum(ad_value), 0) from notas_unicas)');
    definicion := replace(definicion, '(select count(*) from notas where ad_value is null)', '(select count(*) from notas_unicas where ad_value is null)');
    definicion := replace(definicion, '(select count(*) from notas where forzada)', '(select count(*) from notas_unicas where forzada)');
    execute definicion;
  end if;
end;
$clip$;

do $test$
declare
  definicion text;
  inyeccion text := $cte$), notas_ranked as (
  select n.*,
    row_number() over (
      partition by coalesce(
        nullif(public.v4_keyword_norm(coalesce(n.titulo, '')), ''),
        case
          when nullif(n.url, '') is not null
            then 'url:' || lower(regexp_replace(n.url, '[?#].*$', '', 'g'))
          else 'id:' || n.candidata_id::text
        end
      )
      order by n.forzada desc,
        (n.tier is not null) desc,
        n.tier asc nulls last,
        n.confianza desc nulls last,
        n.ad_value desc nulls last,
        n.fecha_pub desc nulls last,
        n.candidata_id
    ) as rn
  from notas n
), notas_unicas as (
  select * from notas_ranked where rn = 1$cte$;
begin
  select pg_get_functiondef(
    'public.v4_test_armar_clipping(uuid)'::regprocedure
  ) into definicion;
  if position('notas_ranked as' in definicion) = 0 then
    if position('), por_seccion as (' in definicion) = 0 then
      raise exception 'No coincide el armado de test; no se modifica a ciegas.';
    end if;
    definicion := replace(definicion, '), por_seccion as (', inyeccion || '), por_seccion as (');
    definicion := replace(definicion, 'left join notas n', 'left join notas_unicas n');
    definicion := replace(definicion, '(select count(*) from notas)', '(select count(*) from notas_unicas)');
    definicion := replace(definicion, '(select coalesce(sum(ad_value), 0) from notas)', '(select coalesce(sum(ad_value), 0) from notas_unicas)');
    definicion := replace(definicion, '(select count(*) from notas where ad_value is null)', '(select count(*) from notas_unicas where ad_value is null)');
    definicion := replace(definicion, '(select count(*) from notas where forzada)', '(select count(*) from notas_unicas where forzada)');
    execute definicion;
  end if;
end;
$test$;

-- En BMS quitamos solo los veredictos de baja confianza que no son una marca
-- explícita. No modifica los otros clientes ni la regla de COVID.
do $bmscalidad$
declare
  definicion text;
  viejo text := '    and v.entra';
  nuevo text := E'    and not (\n      (select lower(coalesce(slug, '''')) from public.clients where id = p_client_id) = ''bms''\n      and not coalesce(v.forzada, false)\n      and coalesce(v.confianza, 0) < 0.85\n    )\n    and v.entra';
begin
  select pg_get_functiondef('public.armar_clipping(uuid,date,text)'::regprocedure) into definicion;
  if position('coalesce(v.confianza, 0) < 0.85' in definicion) = 0 then
    if position(viejo in definicion) = 0 then
      raise exception 'No coincide el filtro de calidad productivo; no se modifica a ciegas.';
    end if;
    execute replace(definicion, viejo, nuevo);
  end if;
end;
$bmscalidad$;

do $bmscalidadtest$
declare
  definicion text;
  viejo text := '  where v.run_id = p_run_id and v.entra';
  nuevo text := E'  where v.run_id = p_run_id\n    and not (\n      (select lower(coalesce(slug, '''')) from public.clients where id = r.client_id) = ''bms''\n      and not coalesce(v.forzada, false)\n      and coalesce(v.confianza, 0) < 0.85\n    )\n    and v.entra';
begin
  select pg_get_functiondef('public.v4_test_armar_clipping(uuid)'::regprocedure) into definicion;
  if position('coalesce(v.confianza, 0) < 0.85' in definicion) = 0 then
    if position(viejo in definicion) = 0 then
      raise exception 'No coincide el filtro de calidad de test; no se modifica a ciegas.';
    end if;
    execute replace(definicion, viejo, nuevo);
  end if;
end;
$bmscalidadtest$;

comment on function public.v4_candidatas_aceptadas_operativo(uuid, date, boolean) is
  'Pool operativo: el rescate de fuentes monitoreadas sin keyword aplica solo a BMS; los demás clientes conservan keywords y compuertas duras.';
