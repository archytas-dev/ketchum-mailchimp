insert into public.clients (slug, nombre) values
  ('bms','BMS'),
  ('booking','Booking'),
  ('msd','MSD Salud Animal'),
  ('mars','MARS')
on conflict (slug) do nothing;
