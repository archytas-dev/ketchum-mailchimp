-- El paginado de PMFarma se actualiza con demora. /api/noticias-recientes
-- contiene las notas del día, incluida la 62582 que se auditó.
update public.medios_estrategia
set url_recurso = 'https://api.pmfarma.com/api/noticias-recientes', updated_at = now()
where dominio_norm = 'pmfarma.com' and formato = 'api_pmfarma';

update public.medios_fuentes
set url_feed = 'https://api.pmfarma.com/api/noticias-recientes', updated_at = now()
where id = '70a36dfa-d12c-4756-b9ae-4152405fc82d' and formato = 'api_pmfarma';
