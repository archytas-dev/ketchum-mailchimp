-- KET-46: "todos los medios que Archytas manda que deberian salir y no salieron, se sumen
-- a una base de datos". No corresponde a medios_bloqueados (eso es cuando el SCRAPER intento
-- y fallo tecnicamente) ni a notas_descartadas (cuando la nota SI se encontro pero se filtro).
-- Este es un tercer caso distinto: el cliente avisa por fuera del sistema (Slack, mail) que
-- esperaba cobertura de un medio/nota y no aparecio, sin que el sistema haya "intentado" nada
-- registrable. Decision de Adrian, 07/08/2026: tabla nueva, staff-only.

create table public.medios_seguimiento (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  medio       text not null,
  descripcion text not null,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','en_revision','resuelto','descartado')),
  resolucion  text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  resuelto_at timestamptz
);
create index on public.medios_seguimiento (client_id, estado);

alter table public.medios_seguimiento enable row level security;
create policy medios_seguimiento_staff on public.medios_seguimiento for all
  using (is_staff()) with check (is_staff());
