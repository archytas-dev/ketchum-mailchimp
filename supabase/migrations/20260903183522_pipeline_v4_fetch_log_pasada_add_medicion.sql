-- El workflow aislado de medicion escribe fetch_log con pasada='medicion'.
-- Aplicado a produccion el 2026-09-03.

alter table fetch_log drop constraint if exists fetch_log_pasada_check;
alter table fetch_log add constraint fetch_log_pasada_check
  check (pasada in ('nocturna_1','nocturna_2','nocturna_3','caliente','diurna','medicion'));
