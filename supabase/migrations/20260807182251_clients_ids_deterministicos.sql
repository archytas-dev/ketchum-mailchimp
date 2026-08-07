-- Deuda encontrada el 07/08/2026 al armar el clon local: `seed_clients` (20260711154942)
-- inserta los clientes SIN id, asi que cada entorno genera sus propios UUIDs con
-- gen_random_uuid(). El problema es que los UUIDs de produccion quedaron hardcodeados en
-- todos lados: los 4 workflows v3 de n8n (Prep Supabase Rows, Leer Precarga Pendiente, los
-- PATCH a medios, Prep Run Stats...) y en toda la data de config. Si se reconstruye
-- produccion desde cero, o se levanta un staging (TDD Fase 4), los clientes salen con otros
-- ids y todo lo que los tiene hardcodeados apunta a la nada.
--
-- Fix: fijar los ids reales de produccion via upsert por slug (que es unique). En produccion
-- esto es un no-op real (el id ya es ese valor). En un entorno limpio (local, staging,
-- disaster recovery), deja los clientes con los mismos ids que produccion desde el arranque.
--
-- No incluye los *-test porque esos son internos de Archytas (creados a mano el 05-06/08) y
-- no tienen nada externo que dependa de un id especifico -- si un entorno nuevo los genera
-- con otro uuid no rompe nada.

insert into public.clients (id, slug, nombre) values
  ('609abde9-b522-4bf1-85e1-5b2a482e4902', 'bms', 'BMS'),
  ('c6ca0491-85f7-47e9-bd77-01d67367457a', 'booking', 'Booking'),
  ('a19f3009-d37d-44b4-b23a-471edde8c567', 'mars', 'MARS'),
  ('051ddae9-9c98-446e-af33-a4cc21b2afb7', 'msd', 'MSD Salud Animal')
on conflict (slug) do update set id = excluded.id;
