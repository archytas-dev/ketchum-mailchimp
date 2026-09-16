-- Fixes 5 y 6 del roadmap:
-- 1) no dejar pasar URLs que son listados/archivos, no notas individuales;
-- 2) la validacion de pais del cuerpo se completa en A2, despues de que A1
--    abre la nota y devuelve un fragmento acotado del texto.
--
-- Este archivo solo agrega reglas deterministicas. No elimina candidatas_raw:
-- el pool crudo sigue siendo auditable y la regla se aplica al seleccionar.

insert into public.reglas_filtro (client_id, tipo, valor, compuerta, peso, motivo)
select null, 'patron_url',
  '(^|/)(etiqueta|tag|tags|archivo|archivos|archive|archives|categoria|categorias|category|categories|buscar|search)(/|$)',
  'no_entra_nunca', 100,
  'URL de archivo, etiqueta, categoria o listado; no es una nota individual.'
where not exists (
  select 1
  from public.reglas_filtro r
  where r.client_id is null
    and r.tipo = 'patron_url'
    and r.compuerta = 'no_entra_nunca'
    and r.valor = '(^|/)(etiqueta|tag|tags|archivo|archivos|archive|archives|categoria|categorias|category|categories|buscar|search)(/|$)'
);

insert into public.reglas_filtro (client_id, tipo, valor, compuerta, peso, motivo)
select null, 'patron_titulo',
  '(archives?|archivo|archivos|etiquetas?|tags?|categor[ií]as?)$',
  'no_entra_nunca', 100,
  'Titulo de archivo/listado, no es una nota individual.'
where not exists (
  select 1
  from public.reglas_filtro r
  where r.client_id is null
    and r.tipo = 'patron_titulo'
    and r.compuerta = 'no_entra_nunca'
    and r.valor = '(archives?|archivo|archivos|etiquetas?|tags?|categor[ií]as?)$'
);

comment on table public.reglas_filtro is
  'v4: compuertas de fuentes, fecha, pais, relevancia y descarte de paginas de archivo/listado.';
