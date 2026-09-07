-- [F5.1] Lo que sub/llm-call necesita y no existia: precios, topes y consumo.
--
-- stage_events ya tiene tokens, costo_usd y modelo, asi que el registro tiene
-- donde ir. Lo que faltaba es (a) con que precio convertir tokens en plata y
-- (b) contra que tope comparar antes de llamar.

-- ---------------------------------------------------------------------------
-- Precios por modelo.
--
-- OJO: los precios nacen `verificado=false` A PROPOSITO. Un precio inventado no
-- rompe nada visible: simplemente produce un reporte de costos equivocado, y
-- alguien toma una decision de presupuesto con un numero que nadie chequeo.
-- Los valores sembrados son de referencia y hay que confirmarlos contra la
-- pagina de precios de OpenAI antes de usarlos para cotizar o presupuestar.
-- Mientras verificado=false, sub/llm-call devuelve el costo pero lo marca.
-- ---------------------------------------------------------------------------
create table if not exists public.llm_modelos (
  modelo              text primary key,
  precio_in_usd_1m    numeric,
  precio_out_usd_1m   numeric,
  verificado          boolean not null default false,
  fuente              text,
  notas               text,
  updated_at          timestamptz not null default now()
);

comment on table public.llm_modelos is
  'Precio por millon de tokens de cada modelo. verificado=false significa que el numero es de referencia y NO se puede usar para presupuestar hasta confirmarlo contra la pagina del proveedor.';

insert into public.llm_modelos (modelo, precio_in_usd_1m, precio_out_usd_1m, verificado, fuente, notas)
values
  ('gpt-4o', 2.50, 10.00, false, 'de referencia, sin confirmar',
   'El que usa el AI Filter Paralelo de la v3. Subido desde gpt-4o-mini el 12/08 por mejor adherencia a reglas complejas; ya validado en MSD el 03/07. Tier 1 TPM ~30k contra 200k de mini: mas chance de 429.'),
  ('gpt-4o-mini', 0.15, 0.60, false, 'de referencia, sin confirmar',
   'El modelo anterior del juez. Queda para el escalado inverso: lotes faciles por mini, dudosos por gpt-4o.'),
  ('text-embedding-3-small', 0.02, 0.00, false, 'de referencia, sin confirmar',
   'El del clustering semantico de Prep AI Input. No tiene tokens de salida.')
on conflict (modelo) do nothing;

-- ---------------------------------------------------------------------------
-- Tope de tokens por dia. client_id nulo = tope por defecto para todos.
-- Es un PARAMETRO, no una decision de arquitectura: se cambia con un update.
-- ---------------------------------------------------------------------------
create table if not exists public.llm_topes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references public.clients(id) on delete cascade,
  tokens_dia    integer not null,
  motivo        text,
  updated_at    timestamptz not null default now()
);

create unique index if not exists llm_topes_default_uk
  on public.llm_topes ((1)) where client_id is null;
create unique index if not exists llm_topes_cliente_uk
  on public.llm_topes (client_id) where client_id is not null;

comment on table public.llm_topes is
  'Tope diario de tokens por cliente. La fila con client_id nulo es el default. sub/llm-call lo consulta ANTES de llamar al modelo: si el consumo del dia ya lo supera, no llama y devuelve diagnostico=tope_alcanzado.';

insert into public.llm_topes (client_id, tokens_dia, motivo)
select null, 2000000, 'Default provisorio hasta medir una corrida real. La v3 procesa ~2.000 candidatas por cliente en lotes de 12 con un prompt de 11-20k caracteres; el numero real sale de la primera corrida del A2 y se ajusta con un update.'
where not exists (select 1 from public.llm_topes where client_id is null);

-- ---------------------------------------------------------------------------
-- Consumo del dia, por cliente. Sale del ledger, no de un contador aparte:
-- un contador propio es una segunda verdad que se puede desincronizar.
-- ---------------------------------------------------------------------------
create or replace view public.v4_llm_consumo_dia as
  select r.client_id,
         r.fecha,
         coalesce(sum(e.tokens), 0)      as tokens,
         coalesce(sum(e.costo_usd), 0)   as costo_usd,
         count(*) filter (where e.tokens is not null) as llamadas,
         bool_and(coalesce(m.verificado, false))      as costo_confiable
  from stage_events e
  join pipeline_runs r on r.id = e.run_id
  left join llm_modelos m on m.modelo = e.modelo
  where e.tokens is not null
  group by r.client_id, r.fecha;

comment on view public.v4_llm_consumo_dia is
  'Tokens y costo por cliente y dia, derivados de stage_events. costo_confiable=false significa que al menos un modelo usado tiene precio sin verificar: el numero sirve de orden de magnitud, no para facturar.';

grant select on public.llm_modelos, public.llm_topes, public.v4_llm_consumo_dia to anon, authenticated, service_role;
grant insert, update on public.llm_topes to service_role;
