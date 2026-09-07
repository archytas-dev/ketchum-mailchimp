-- Todo lo que sub/llm-call necesita saber ANTES de llamar al modelo, en una sola
-- consulta: el prompt vigente del cliente, su tope diario y cuanto lleva
-- consumido hoy. Tres viajes a la base por llamada al modelo es un impuesto que
-- se paga en cada lote; aca es uno.
create or replace function public.v4_llm_contexto(
  p_client_id uuid,
  p_modelo text default 'gpt-4o',
  p_fecha date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'prompt',            (select cp.contenido from client_prompts cp
                           where cp.client_id = p_client_id and cp.vigente
                           order by cp.version desc limit 1),
    'prompt_version',    (select cp.version from client_prompts cp
                           where cp.client_id = p_client_id and cp.vigente
                           order by cp.version desc limit 1),
    -- El tope del cliente manda; si no tiene, el default (client_id nulo).
    'tope_dia',          coalesce(
                           (select t.tokens_dia from llm_topes t where t.client_id = p_client_id),
                           (select t.tokens_dia from llm_topes t where t.client_id is null)),
    'consumido_hoy',     coalesce((select c.tokens from v4_llm_consumo_dia c
                                    where c.client_id = p_client_id and c.fecha = p_fecha), 0),
    'precio_in_1m',      (select m.precio_in_usd_1m  from llm_modelos m where m.modelo = p_modelo),
    'precio_out_1m',     (select m.precio_out_usd_1m from llm_modelos m where m.modelo = p_modelo),
    -- false = el precio del modelo no esta confirmado contra el proveedor.
    -- El costo igual se calcula, pero se devuelve marcado.
    'precio_verificado', coalesce((select m.verificado from llm_modelos m where m.modelo = p_modelo), false)
  );
$$;

comment on function public.v4_llm_contexto(uuid, text, date) is
  'Prompt vigente, tope diario, consumo del dia y precios del modelo, en una sola consulta. Lo llama sub/llm-call antes de cada lote.';

grant execute on function public.v4_llm_contexto(uuid, text, date) to anon, authenticated, service_role;
