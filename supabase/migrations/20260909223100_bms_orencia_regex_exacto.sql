-- La migracion anterior dejo las barras duplicadas en el texto del regex.
-- PostgreSQL usa \y como limite de palabra en expresiones regulares.
update public.reglas_filtro
set valor = replace(
      valor,
      '|' || chr(92) || chr(92) || 'yorencia' || chr(92) || chr(92) || 'y|',
      '|' || chr(92) || 'yorencia' || chr(92) || 'y|'
    ),
    updated_at = now()
where id = '7e49b6f6-c1c7-4bb7-9feb-deda88b4c894'
  and valor like '%' || chr(92) || chr(92) || 'yorencia' || chr(92) || chr(92) || 'y%';
