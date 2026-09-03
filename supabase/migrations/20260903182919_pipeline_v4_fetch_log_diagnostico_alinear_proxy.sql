-- El contrato de los proxies de transporte (y de sub/fetch-source) usa un vocabulario de
-- diagnostico mas rico que el CHECK original de fetch_log. Se alinea: proxy set + no_visitado + error.
-- Aplicado a produccion el 2026-09-03, detectado al probar sub/fetch-source.

alter table fetch_log drop constraint if exists fetch_log_diagnostico_check;
alter table fetch_log add constraint fetch_log_diagnostico_check
  check (diagnostico in ('ok','bloqueado','sin_items','no_es_feed','no_existe','caido','timeout','rate_limit','no_visitado','error'));
