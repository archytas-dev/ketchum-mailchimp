-- El bug de las tres horas seguia vivo donde mas duele.
--
-- Lo arreglamos en las FUNCIONES (v4_hoy()) pero los defaults de las TABLAS
-- seguian en CURRENT_DATE, que es UTC. Como el recolector no manda la fecha y
-- deja que la ponga la base, todo lo capturado entre las 21:00 y las 24:00 ART
-- se guardaba con la fecha del dia siguiente.
--
-- Medido antes de tocar nada: de 33.615 notas capturadas en esa franja en los
-- ultimos 5 dias, 33.608 tenian la fecha corrida un dia. No era un caso borde:
-- era una de las nueve ventanas del barrido entera, todos los dias.
--
-- Consecuencia practica: el clipping de la manana nunca veia las notas de la
-- noche anterior. La pregunta que teniamos abierta con Ketchum —si el clipping
-- deberia llevarlas— estaba contestada de hecho, y por accidente.

alter table public.candidatas_raw alter column fecha set default v4_hoy();
alter table public.fetch_log      alter column fecha set default v4_hoy();

-- Esta no tenia ningun default, y la nota del nodo que la escribia afirmaba que
-- si. Por eso el primer intento de guardar un veredicto en modo test rebotaba
-- con 23502: nadie lo habia visto porque en test antes no se escribia.
alter table public.candidatas_veredicto alter column fecha set default v4_hoy();

comment on column public.candidatas_raw.fecha is
  'Dia del pool en hora ARGENTINA (v4_hoy()), no UTC. Con CURRENT_DATE, el barrido de las 23:00 ART caia en el dia siguiente.';
comment on column public.fetch_log.fecha is
  'Dia en hora ARGENTINA (v4_hoy()), no UTC. Ver candidatas_raw.fecha.';