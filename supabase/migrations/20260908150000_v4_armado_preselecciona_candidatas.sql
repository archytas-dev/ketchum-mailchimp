-- [Z.4] El armado no debe gastar el timeout de PostgREST evaluando todo el
-- histórico de candidatas para devolver un lote chico.
--
-- `v4_evaluar_candidatas()` queda intacta: sigue siendo el evaluador completo
-- que explica cada descarte y alimenta la auditoría. Esta ruta solo sirve al
-- armado de agentes, que necesita las candidatas que pueden entrar.
--
-- La preselección no cambia decisiones:
--   * las notas recientes y las que no tienen fecha confiable se evalúan igual;
--   * las notas viejas solo pasan si mencionan una marca prioritaria, porque
--     antigüedad las descarta antes de cualquier otra regla salvo marca;
--   * las futuras nunca pueden entrar y no se envían al bloque caro.
--
-- Así se conserva el comportamiento de entrada, pero el armado no ejecuta las
-- regex de tema sobre las decenas de miles de filas que ya están fuera de la
-- ventana. La decisión de por qué se descarta una nota sigue viviendo en el
-- evaluador completo, no en esta ruta de rendimiento.

create or replace function public.v4_candidatas_del_dia(
  p_client_id uuid,
  p_fecha date default null,
  p_limite int default 60
)
returns table (
  candidata_id uuid, titulo text, snippet text, url text,
  dominio_norm text, fecha_pub timestamptz, fecha_confiable boolean,
  es_prioritaria boolean, transporte text
)
language sql
stable
security definer
set search_path to 'public'
as $$
with params as (
  select
    coalesce(p_fecha, v4_hoy()) as dia,
    ((coalesce(p_fecha, v4_hoy()) + 1)::timestamp
      at time zone 'America/Argentina/Buenos_Aires') as corte,
    greatest(1, least(p_limite, 200)) as limite
),
cfg as (
  select
    p.*,
    coalesce((select max(rf.valor::int)
      from reglas_filtro rf
      where rf.activa and rf.tipo = 'antiguedad'
        and rf.compuerta = 'no_entra_nunca'
        and (rf.client_id is null or rf.client_id = p_client_id)), 24) as ventana_h
  from params p
),
reglas as (
  select rf.*
  from reglas_filtro rf
  where rf.activa and (rf.client_id is null or rf.client_id = p_client_id)
),
suscritas as (
  select c.*, cfg.dia, cfg.corte, cfg.ventana_h, cfg.limite
  from candidatas_raw c
  join medios_fuentes f
    on f.id = c.fuente_id and f.activa is true
  join medios_suscripcion m
    on m.fuente_id = f.id
   and m.client_id = p_client_id
   and coalesce(m.bloqueado, false) = false
  cross join cfg
  where c.fecha = cfg.dia
    and (
      -- Sin fecha propia no podemos aplicar el corte: el evaluador completo
      -- todavía debe resolver `vista_antes_sin_fecha`.
      not c.fecha_confiable
      or c.fecha_pub is null
      -- Las recientes conservan exactamente todas las compuertas actuales.
      or c.fecha_pub >= cfg.corte - make_interval(hours => cfg.ventana_h)
      -- Una nota vieja solo puede sobrevivir si entra por marca explícita.
      or exists (
        select 1
        from reglas r
        where r.compuerta = 'entra_si_o_si'
          and r.tipo = 'patron_titulo'
          and (coalesce(c.titulo, '') || ' ' || coalesce(c.snippet, '')) ~* r.valor
      )
    )
),
ev as (
  select s.*,
    (coalesce(s.titulo, '') || ' ' || coalesce(s.snippet, '')) as txt,
    (select r.id
       from reglas r
      where r.compuerta = 'desambiguacion'
        and ((r.tipo = 'patron_titulo'
              and (coalesce(s.titulo, '') || ' ' || coalesce(s.snippet, '')) ~* r.valor)
          or (r.tipo = 'patron_url' and coalesce(s.url, '') ~* r.valor))
      limit 1) as regla_ambigua,
    exists (
      select 1
      from reglas r
      where r.compuerta = 'entra_si_o_si'
        and r.tipo = 'patron_titulo'
        and (coalesce(s.titulo, '') || ' ' || coalesce(s.snippet, '')) ~* r.valor
    ) as menciona_marca,
    (select r.id
       from reglas r
      where r.compuerta = 'no_entra_nunca'
        and ((r.tipo = 'patron_titulo'
              and (coalesce(s.titulo, '') || ' ' || coalesce(s.snippet, '')) ~* r.valor
              and not (r.valor ~ 'espa'
                       and (coalesce(s.titulo, '') || ' ' || coalesce(s.snippet, '')) ~* 'argentin')
              and not (r.valor ~ 'volkswagen'
                       and (coalesce(s.titulo, '') || ' ' || coalesce(s.snippet, '')) ~*
                           '(enfermedad|vacuna|brote|sanidad|sanitari|zoonosis|parasit|garrapata|mastitis|bienestar animal)')
              and not (r.valor ~ 'senasa'
                       and (coalesce(s.titulo, '') || ' ' || coalesce(s.snippet, '')) ~*
                           '(aliment|nutricion|petfood|mascota|perro|gato|balanceado|golosina|chocolat|confiter|snack)'))
          or (r.tipo = 'patron_url' and coalesce(s.url, '') ~* r.valor)
          or (r.tipo = 'tld' and s.dominio_norm ~* r.valor)
          or (r.tipo = 'dominio' and s.dominio_norm ~* r.valor))
      limit 1) as regla_tema,
    (s.fecha_confiable and s.fecha_pub < s.corte - make_interval(hours => s.ventana_h)) as es_vieja,
    (s.fecha_confiable and s.fecha_pub >= s.corte) as fecha_futura,
    (length(coalesce(s.titulo, '')) < coalesce((select max(r.valor::int)
      from reglas r where r.compuerta = 'no_entra_nunca' and r.tipo = 'titulo_corto'), 25)
     and length(coalesce(s.snippet, '')) < 20) as titulo_pobre,
    (select min(c2.fecha)
       from candidatas_raw c2
      where c2.url_canonica = s.url_canonica
        and c2.fecha < s.dia) as primera_vez
  from suscritas s
),
gated as (
  select e.*,
    (e.menciona_marca and e.regla_ambigua is null) as es_prioritaria,
    case
      when e.regla_ambigua is not null then 'desambiguacion'
      when e.fecha_futura              then 'fecha_futura'
      when e.menciona_marca            then null
      when e.regla_tema is not null    then 'regla_tema'
      when e.es_vieja                  then 'antiguedad'
      when (not e.fecha_confiable) and e.primera_vez is not null
        then 'vista_antes_sin_fecha'
      when e.titulo_pobre              then 'titulo_pobre'
      else null
    end as gate
  from ev e
),
deduped as (
  select g.*,
    case when g.gate is null then row_number() over (
      partition by g.dominio_norm,
        lower(regexp_replace(coalesce(g.titulo, ''), '[^a-zA-Z0-9]+', '', 'g'))
      order by g.es_prioritaria desc, g.fecha_confiable desc,
               g.fecha_pub desc nulls last, g.capturado_at) end as rn
  from gated g
),
veredicto as (
  select d.*,
    coalesce(d.gate,
      case
        when d.rn > 1 then 'repetida_en_el_dia'
        when es_repetida_al(p_client_id, d.url_canonica, d.dia) then 'ya_enviada'
      end) as decision
  from deduped d
)
select v.id, v.titulo, v.snippet, v.url, v.dominio_norm, v.fecha_pub,
       v.fecha_confiable, v.es_prioritaria,
       coalesce(me.transporte, 'directo')
from veredicto v
left join medios_estrategia me on me.dominio_norm = v.dominio_norm
where v.decision is null
order by v.es_prioritaria desc, v.fecha_pub desc nulls last
limit (select limite from cfg);
$$;

comment on function public.v4_candidatas_del_dia(uuid, date, int) is
  'Candidatas del dia para los agentes. Preselecciona por ventana/fecha/marca antes de ejecutar las compuertas caras; el evaluador completo conserva la auditoria de descartes.';

grant execute on function public.v4_candidatas_del_dia(uuid, date, int)
  to anon, authenticated, service_role;
