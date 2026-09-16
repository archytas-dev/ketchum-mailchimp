-- BMS: `orencia` sin limites matcheaba nombres como Florencia.
-- Se conserva la regla de entrada obligatoria, pero solo para la molecula Orencia.
update public.reglas_filtro
set valor = replace(valor, '|orencia|', '|\\yorencia\\y|'),
    updated_at = now()
where id = '7e49b6f6-c1c7-4bb7-9feb-deda88b4c894'
  and valor like '%|orencia|%';
