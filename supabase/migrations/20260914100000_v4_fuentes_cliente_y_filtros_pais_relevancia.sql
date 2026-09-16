-- Fixes 3 y 4 del roadmap:
-- 1) una candidata solo puede entrar al pool del cliente de su suscripcion o
--    de su Google Alert;
-- 2) pais y ruido editorial obvio se descartan antes de A1/A2.
--
-- El pool raw sigue siendo compartido a proposito. Lo que se separa aqui es
-- la seleccion por cliente, no la recoleccion comun.

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

  if v_client_id is null or v_fuente_id is null then
    raise exception 'No se puede asociar la candidata % con un cliente/fuente valido', new.candidata_id
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

drop trigger if exists v4_fuente_cliente on public.pipeline_run_candidatas;
create trigger v4_fuente_cliente
before insert or update of run_id, candidata_id
on public.pipeline_run_candidatas
for each row execute function public.v4_guardar_candidata_del_cliente();

drop trigger if exists v4_fuente_cliente on test.v4_pipeline_run_candidatas;
create trigger v4_fuente_cliente
before insert or update of run_id, candidata_id
on test.v4_pipeline_run_candidatas
for each row execute function public.v4_guardar_candidata_del_cliente();

-- Pais: se mantienen las notas argentinas aunque mencionen otro pais. La
-- excepcion ya forma parte de la compuerta no_entra_nunca para los patrones
-- cuyo valor contiene "espa".
insert into public.reglas_filtro (client_id, tipo, valor, compuerta, peso, motivo)
select null, 'patron_titulo',
  '(\\yreino\\s+unido\\y|\\yinglaterra\\y|\\yespa(na|ña)\\y|\\yfrancia\\y|\\yalemania\\y|\\yitalia\\y|\\yportugal\\y|\\ym[eé]xico\\y|\\ybrasil\\y|\\ychile\\y|\\ycolombia\\y|\\yper[uú]\\y|\\ybolivia\\y|\\yparaguay\\y|\\yuruguay\\y|\\yecuador\\y|\\ycanad[aá]\\y|\\yestados\\s+unidos\\y|\\yee\\.?uu\\.?\\y|\\yusa\\y|\\ychina\\y|\\yjap[oó]n\\y|\\yaustralia\\y|\\yrusia\\y|\\yucrania\\y|\\yisrael\\y|\\yindia\\y|\\ysud[aá]frica\\y)',
  'no_entra_nunca', 100,
  'Nota centrada en otro pais. Si el titulo tambien menciona Argentina, se conserva para revision.'
where not exists (
  select 1 from public.reglas_filtro r
  where r.client_id is null
    and r.tipo = 'patron_titulo'
    and r.compuerta = 'no_entra_nunca'
    and r.motivo = 'Nota centrada en otro pais. Si el titulo tambien menciona Argentina, se conserva para revision.'
);

-- Relevancia: ruido manifiesto que habia llegado a BMS por keywords amplias
-- o por una fuente monitoreada. Se deja el juez para los casos grises.
insert into public.reglas_filtro (client_id, tipo, valor, compuerta, peso, motivo)
select c.id, 'patron_titulo', v.valor, 'no_entra_nunca', 100, v.motivo
from public.clients c
cross join (values
  ('bms', '(\\yf[uú]tbol\\y|\\ynba\\y|\\ynfl\\y|\\ynhl\\y|\\ytenis\\y|\\yb[aá]squet\\y|\\yf[aá]r[aá]ndula\\y|obra\\s+de\\s+teatro|\\yflorencia\\s+pe[nñ]a\\y|\\ymessi\\y|m[aá]m[aá]\\s+de\\s+messi|curso\\s+de\\s+preparto|\\yautismo\\y)', 'Deportes, espectaculos o cursos sin relacion con el clipping BMS.'),
  ('mars', '(\\yf[uú]tbol\\y|\\ynba\\y|\\ynfl\\y|\\ynhl\\y|\\ytenis\\y|\\yb[aá]squet\\y|\\yf[aá]r[aá]ndula\\y|obra\\s+de\\s+teatro|\\ymessi\\y|policiales?)', 'Ruido deportivo, de espectaculos o policial ajeno a Mars.'),
  ('msd', '(\\yf[uú]tbol\\y|\\ynba\\y|\\ynfl\\y|\\ynhl\\y|\\ytenis\\y|\\yb[aá]squet\\y|\\yf[aá]r[aá]ndula\\y|obra\\s+de\\s+teatro|\\ymessi\\y|policiales?)', 'Ruido deportivo, de espectaculos o policial ajeno a MSD Salud Animal.')
) as v(slug, valor, motivo)
where lower(c.slug) = v.slug
  and not exists (
    select 1 from public.reglas_filtro r
    where r.client_id = c.id
      and r.tipo = 'patron_titulo'
      and r.compuerta = 'no_entra_nunca'
      and r.valor = v.valor
  );

comment on function public.v4_guardar_candidata_del_cliente() is
  'Protege el pool por cliente: una candidata solo entra por su suscripcion activa o su Google Alert del cliente.';
