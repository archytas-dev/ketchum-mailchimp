-- La regla anti-repeticion: determinista y barata.
--
-- Dos problemas en una sola funcion:
--
-- 1. Media contra `current_date - 30`, o sea contra el reloj. Es el mismo
--    defecto que [F4.6] arreglo en la compuerta de antiguedad, de segundo
--    orden (30 dias drifean menos que 24 h) pero del mismo tipo.
-- 2. Recalculaba url_canonica() —con su decode base64— por cada nota, sobre
--    una URL que candidatas_raw YA tiene canonizada en una columna generada.
--    Con el corte viejo sobrevivian 74 notas y no se notaba; con el corte de
--    [F4.6] sobreviven miles y la corrida de los cuatro clientes se murio por
--    statement timeout.
--
-- No se le puede cambiar la firma: import_clipping(), que esta en produccion,
-- la usa. Asi que la regla se muda a es_repetida_al() y es_repetida() queda
-- como fachada que delega. Una sola definicion, dos puertas de entrada.
--
-- Verificado antes de confiar en la columna generada: de 20.000 filas del pool
-- del 04/09, 0 difieren de url_canonica(url) con la funcion actualizada por
-- [F4.1]. No hay valores congelados con la canonizacion vieja.

create or replace function public.es_repetida_al(
  p_client_id uuid,
  p_url_canonica text,
  p_fecha date
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from notas_historico_url h
    where h.client_id = p_client_id
      and h.url_norm  = p_url_canonica
      and h.primera_vez_fecha >= p_fecha - 30
  );
$$;

comment on function public.es_repetida_al(uuid, text, date) is
  'Se le envio esta nota al cliente en los 30 dias previos a p_fecha. Determinista y sin recalcular url_canonica: espera la URL ya canonizada (candidatas_raw.url_canonica es columna generada). Golpea el indice unico (client_id, url_norm).';

create or replace function public.es_repetida(p_client_id uuid, p_url text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select es_repetida_al(p_client_id, url_canonica(p_url), current_date);
$$;

comment on function public.es_repetida(uuid, text) is
  'Compatibilidad para el camino v3 (import_clipping). Canoniza y mide contra el reloj. Lo nuevo usa es_repetida_al(), que es determinista.';
