-- Precio y disponibilidad verificados contra el catálogo oficial de OpenAI:
-- https://developers.openai.com/api/docs/models/gpt-5.6-luna
insert into llm_modelos (
  modelo,
  precio_in_usd_1m,
  precio_out_usd_1m,
  verificado,
  fuente,
  notas,
  updated_at
)
values (
  'gpt-5.6-luna',
  0.20,
  1.20,
  true,
  'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
  'Modelo Luna de GPT-5.6: alto volumen y costo contenido. El juez usa reasoning_effort=none como línea base de latencia; se valida contra los cuatro clippings antes de subir el esfuerzo.',
  now()
)
on conflict (modelo) do update
set precio_in_usd_1m = excluded.precio_in_usd_1m,
    precio_out_usd_1m = excluded.precio_out_usd_1m,
    verificado = excluded.verificado,
    fuente = excluded.fuente,
    notas = excluded.notas,
    updated_at = excluded.updated_at;
