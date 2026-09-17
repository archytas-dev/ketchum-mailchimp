-- [W0.25] Corrige configuracion v4 sin tocar public.medios ni clipping v3.
begin;

-- Solo se reactivan fuentes cuyo equivalente sigue activo en la configuracion vigente.
update public.medios_suscripcion s
set bloqueado = false,
    motivo_bloqueo = null,
    updated_at = now()
where coalesce(s.bloqueado, false)
  and exists (
    select 1
    from public.medios_fuentes f
    join public.medios m
      on m.client_id = s.client_id
     and m.activo
     and lower(regexp_replace(regexp_replace(regexp_replace(trim(m.dominio), '^https?://', '', 'i'), '^www[.]', '', 'i'), '/.*$', '')) = f.dominio_norm
    where f.id = s.fuente_id
  );

-- Toda fuente prioritaria sin transporte quedaba fuera de la cola diaria.
-- Cloudflare es el transporte normal de v4 para feeds y paginas HTML.
update public.medios_estrategia e
set transporte = 'cloudflare',
    ultimo_diagnostico = null,
    updated_at = now()
where e.transporte is null
  and exists (
    select 1
    from public.v4_fuentes_prioritarias p
    join public.medios_fuentes f on f.id = p.fuente_id
    where f.activa
      and f.dominio_norm = e.dominio_norm
  );

commit;
