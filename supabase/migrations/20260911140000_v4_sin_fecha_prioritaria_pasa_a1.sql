-- Una lista puede omitir fecha aunque la nota la publique en su HTML.
-- Si la fuente es monitoreada o tiene tier, A1 debe abrirla antes de que el
-- filtro duro de keywords la descarte. A2 conserva la decisión editorial.
do $migracion$
declare
  rapida text;
  operativa text;
begin
  select pg_get_functiondef('public.v4_candidatas_aceptadas_rapido(uuid,date,boolean)'::regprocedure) into rapida;
  if position('select f.*, (f.marca or f.viene_de_alerta) and not f.ambigua as es_prioritaria' in rapida) = 0 then
    raise exception 'No coincide la funcion rapida; no se reemplaza a ciegas.';
  end if;
  rapida := replace(rapida,
    'select f.*, (f.marca or f.viene_de_alerta) and not f.ambigua as es_prioritaria',
    'select f.*, (f.marca or f.viene_de_alerta or f.fuente_monitoreada or f.fuente_tier is not null) and not f.ambigua as es_prioritaria');
  execute rapida;

  select pg_get_functiondef('public.v4_candidatas_aceptadas_operativo(uuid,date,boolean)'::regprocedure) into operativa;
  if position('select q.candidata_id, q.fecha_pub, c.titulo, c.alerta_id' in operativa) = 0
     or position('where a.tiene_marca_titulo or a.tiene_keyword_no_generica or (a.tiene_keyword_titulo and (select slug from cliente) <> ''mars'');' in operativa) = 0 then
    raise exception 'No coincide la funcion operativa; no se reemplaza a ciegas.';
  end if;
  operativa := replace(operativa,
    'select q.candidata_id, q.fecha_pub, c.titulo, c.alerta_id',
    'select q.candidata_id, q.fecha_pub, q.es_prioritaria as fuente_prioritaria, c.fecha_confiable, c.titulo, c.alerta_id');
  operativa := replace(operativa,
    'select a.candidata_id, a.tiene_marca_titulo as es_prioritaria, a.fecha_pub',
    'select a.candidata_id, (a.tiene_marca_titulo or (a.fuente_prioritaria and not a.fecha_confiable)) as es_prioritaria, a.fecha_pub');
  operativa := replace(operativa,
    'where a.tiene_marca_titulo or a.tiene_keyword_no_generica or (a.tiene_keyword_titulo and (select slug from cliente) <> ''mars'');',
    'where a.tiene_marca_titulo or a.tiene_keyword_no_generica or (a.tiene_keyword_titulo and (select slug from cliente) <> ''mars'') or (a.fuente_prioritaria and not a.fecha_confiable);');
  execute operativa;
end;
$migracion$;
