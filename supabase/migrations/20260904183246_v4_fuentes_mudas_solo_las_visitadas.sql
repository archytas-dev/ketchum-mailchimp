-- La primera version metia en "mudas" a las de brightdata, cuyo unico diagnostico es
-- 'no_visitado'. Eso no es una fuente muda, es una fuente sin conectar — y mezclarlas
-- diluye la señal exactamente como contar no_visitado en el denominador de cobertura.
--
-- Muda = SE VISITO y no dio una sola nota. Si nunca se intento, el problema es otro
-- y esta en otro ticket.

drop view if exists public.v4_fuentes_mudas;

create view public.v4_fuentes_mudas as
select
  f.id            as fuente_id,
  f.dominio_norm,
  e.transporte,
  c.ritmo_publicacion_semanal,
  count(*) filter (where l.diagnostico <> 'no_visitado')  as intentos_reales_14d,
  mode() within group (order by l.diagnostico)            as diagnostico_mas_comun,
  max(l.ts)                                               as ultimo_intento
from public.medios_fuentes f
join public.medios_estrategia e on e.dominio_norm = f.dominio_norm
join public.medios_catalogo   c on c.dominio_norm = f.dominio_norm
join public.fetch_log         l on l.fuente_id = f.id
                               and l.pasada like 'barrido_%'
                               and l.ts > now() - interval '14 days'
where f.activa is true
  and e.transporte is not null
  and e.metodo_extraccion = 'feed'
group by f.id, f.dominio_norm, e.transporte, c.ritmo_publicacion_semanal
having count(*) filter (where l.diagnostico = 'ok') = 0            -- nunca trajo nada
   and count(*) filter (where l.diagnostico <> 'no_visitado') > 0  -- pero si se intento
order by c.ritmo_publicacion_semanal desc nulls last, f.dominio_norm;

comment on view public.v4_fuentes_mudas is
  'Fuentes con transporte que se supone que funciona, que SI se visitaron y que en 14 dias no trajeron una sola nota. Excluye las que solo tienen no_visitado (brightdata sin conectar): esas no estan mudas, estan sin conectar. Es el aviso de los 14 dias en cero de la pantalla de salud de fuentes (Fase 7).

OJO: medios_catalogo.ritmo_publicacion_semanal esta sin poblar (todo NULL), asi que el orden por ritmo todavia no prioriza nada. Poblarlo es lo que convierte esta vista en una alerta util: un medio que publica 50 notas por semana y esta mudo es un problema; uno que publica una cada tanto, no.';
