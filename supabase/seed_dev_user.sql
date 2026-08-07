-- Usuario de desarrollo SINTETICO para el entorno local.
--
-- No se clonan los usuarios reales del remoto (los mails de Fedra y del equipo de Ketchum
-- no bajan a local), asi que se crea uno propio con rol dev y acceso a los 8 clientes.
--
-- Se hace todo por SQL a proposito: la via "correcta" seria la Auth Admin API, pero eso
-- obliga a pasar por HTTP con la service_role key y a leer `supabase status`, que en
-- PowerShell 5.1 rompe (trata el stderr de un exe nativo como error fatal). Por SQL corre
-- solo en cada `db reset`, sin depender de nada externo.
--
-- Login local:  dev@archytas.local  /  devlocal123

do $$
declare
  v_user_id uuid;
  v_email   text := 'dev@archytas.local';
  v_pass    text := 'devlocal123';
begin
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    -- Las columnas de token van en '' y NO en null: GoTrue las lee como string no-nullable
    -- de Go, y con null el login falla con 500 "Database error querying schema" (que no dice
    -- nada sobre la causa real). Es la trampa clasica de crear usuarios a mano por SQL.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone_change_token, email_change_token_current, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, crypt(v_pass, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', ''
    );

    -- GoTrue necesita la identity para que funcione el login con email+password.
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      v_user_id::text, v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  -- Rol dev: ve los 8 clientes (incluidos los *-test) y las dimensiones staff-only
  -- como Google Alerts. Ver el mapa de permisos en fase0_roles_and_rls.
  insert into public.profiles (id, nombre, rol)
  values (v_user_id, 'Dev Local', 'dev')
  on conflict (id) do update set rol = 'dev', nombre = 'Dev Local';

  insert into public.user_client_access (user_id, client_id)
  select v_user_id, c.id from public.clients c
  on conflict do nothing;

  raise notice 'Usuario dev local listo: % (id %)', v_email, v_user_id;
end $$;
