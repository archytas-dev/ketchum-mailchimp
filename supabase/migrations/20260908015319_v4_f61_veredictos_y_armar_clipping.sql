-- [F6.1] Donde aterriza lo que decide el A2, y como se arma el clipping.
--
-- Faltaba la tabla del medio: el pool esta en candidatas_raw, los descartes en
-- notas_descartadas, pero "las que entran y en que seccion" no tenia donde ir.

create table if not exists public.candidatas_veredicto (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  fecha           date not null,
  candidata_id    uuid not null references public.candidatas_raw(id) on delete cascade,
  entra           boolean not null,
  seccion         text,
  confianza       numeric,
  forzada         boolean not null default false,
  motivo_forzada  text,
  agente          text not null default 'a2',
  created_at      timestamptz not null default now()
);

-- Idempotencia (mandamiento 6): re-correr el A2 el mismo dia actualiza, no
-- duplica. Es la misma leccion que costo el indice de notas_descartadas.
create unique index if not exists candidatas_veredicto_uk
  on public.candidatas_veredicto (client_id, fecha, candidata_id);

create index if not exists candidatas_veredicto_dia_idx
  on public.candidatas_veredicto (client_id, fecha) where entra;

comment on table public.candidatas_veredicto is
  'Salida del A2: por nota, si entra y en que seccion, con la confianza y si hubo que forzarla. `forzada` marca los casos donde el juez dijo una cosa y una regla dura dijo otra — no se resuelve en silencio.';

grant select, insert, update on public.candidatas_veredicto to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El armado. Deterministico y en SQL: una definicion para los cuatro clientes,
-- y dos corridas del mismo dia dan lo mismo.
--
-- El orden NO es una preferencia estetica: dentro de cada seccion las notas van
-- por ad value descendente, que es el criterio con el que el cliente lee. Una
-- nota sin valorizar va al final, no al principio: si no sabemos cuanto vale,
-- no la ponemos arriba.
-- ---------------------------------------------------------------------------
create or replace function public.armar_clipping(
  p_client_id uuid,
  p_fecha date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with notas as (
  select
    v.candidata_id,
    v.seccion,
    v.confianza,
    v.forzada,
    c.titulo,
    c.snippet,
    c.url,
    c.url_canonica,
    c.dominio_norm,
    c.fecha_pub,
    c.fecha_confiable,
    -- El ad value del medio; si el dominio no esta valorizado, el default de su
    -- tier; si tampoco, null. Nunca cero: cero es un valor, null es "no sabemos".
    coalesce(t.ad_value, td.ad_value) as ad_value,
    t.tier,
    t.alcance,
    coalesce(t.medio, c.dominio_norm) as medio
  from candidatas_veredicto v
  join candidatas_raw c on c.id = v.candidata_id
  left join tiers t
    on t.client_id = p_client_id and lower(t.dominio) = lower(c.dominio_norm)
  left join tier_defaults td
    on td.client_id = p_client_id and td.tier = t.tier
  where v.client_id = p_client_id and v.fecha = p_fecha and v.entra
),
por_seccion as (
  select
    s.nombre,
    s.orden,
    s.es_exclusiva,
    s.muestra_ad_value,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'candidata_id', n.candidata_id,
        'titulo',       n.titulo,
        'snippet',      n.snippet,
        'url',          n.url,
        'medio',        n.medio,
        'dominio',      n.dominio_norm,
        'fecha_pub',    n.fecha_pub,
        'fecha_confiable', n.fecha_confiable,
        'tier',         n.tier,
        'alcance',      n.alcance,
        'ad_value',     n.ad_value,
        'confianza',    n.confianza,
        'forzada',      n.forzada
      )
      -- nulls last: la nota sin valorizar va al final, no arriba.
      order by n.ad_value desc nulls last, n.fecha_pub desc nulls last, n.titulo
    ) filter (where n.candidata_id is not null), '[]'::jsonb) as notas,
    count(n.candidata_id)                        as cantidad,
    coalesce(sum(n.ad_value), 0)                 as ad_value_seccion,
    count(*) filter (where n.ad_value is null and n.candidata_id is not null) as sin_valorizar
  from secciones s
  left join notas n on n.seccion = s.nombre
  where s.client_id = p_client_id and s.activa
  group by s.nombre, s.orden, s.es_exclusiva, s.muestra_ad_value
)
select jsonb_build_object(
  'client_id', p_client_id,
  'fecha',     p_fecha,
  'total_notas', (select count(*) from notas),
  'ad_value_total', (select coalesce(sum(ad_value), 0) from notas),
  'sin_valorizar',  (select count(*) from notas where ad_value is null),
  'forzadas',       (select count(*) from notas where forzada),
  -- Las secciones vacias se devuelven igual, con cantidad 0: quien arma el HTML
  -- decide si las esconde. Omitirlas aca seria decidir por el.
  'secciones', coalesce((
    select jsonb_agg(jsonb_build_object(
      'nombre', ps.nombre, 'orden', ps.orden,
      'es_exclusiva', ps.es_exclusiva, 'muestra_ad_value', ps.muestra_ad_value,
      'cantidad', ps.cantidad, 'ad_value', ps.ad_value_seccion,
      'sin_valorizar', ps.sin_valorizar, 'notas', ps.notas
    ) order by ps.orden)
    from por_seccion ps), '[]'::jsonb)
);
$$;

comment on function public.armar_clipping(uuid, date) is
  'Arma el clipping del dia: secciones en orden, notas por ad value descendente (sin valorizar al final), con los totales. Deterministico: dos corridas del mismo dia dan lo mismo.';

grant execute on function public.armar_clipping(uuid, date) to anon, authenticated, service_role;
