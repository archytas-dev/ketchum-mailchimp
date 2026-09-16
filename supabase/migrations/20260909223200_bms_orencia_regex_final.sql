-- Normaliza la alternativa Orencia a limites de palabra reales. Se actualiza
-- por ID para no depender del comportamiento de escape de LIKE.
update public.reglas_filtro
set valor = replace(
      valor,
      '|' || chr(92) || chr(92) || 'yorencia' || chr(92) || chr(92) || 'y|',
      '|' || chr(92) || 'yorencia' || chr(92) || 'y|'
    ),
    updated_at = now()
where id = '7e49b6f6-c1c7-4bb7-9feb-deda88b4c894';
