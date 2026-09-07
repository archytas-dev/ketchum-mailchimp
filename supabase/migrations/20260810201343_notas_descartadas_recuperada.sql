-- "Casi entraron" (Actividad): cuando alguien recupera una nota descartada directo al
-- clipping de hoy, hay que dejar de mostrarla como opción -- si no, en el próximo refresh
-- vuelve a aparecer como si nunca se hubiera agregado (notas_descartadas no tiene ningún
-- otro estado que lo indique).
alter table notas_descartadas add column recuperada boolean not null default false;
