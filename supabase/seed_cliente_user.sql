-- Usuario de desarrollo SINTETICO con rol 'cliente' (equivalente a Fedra, pero no es ella --
-- no se clona ningun usuario real). Sirve para probar en local/e2e que el rol cliente NO ve
-- lo que es staff-only (Google Alerts, Seguimiento de KET-46), sin tocar la sesion del
-- usuario dev. Acceso solo a BMS, alcanza para los tests.
--
-- Login: cliente-e2e@archytas.local / clientelocal123

do $$
declare
  v_user_id uuid;
  v_email   text := 'cliente-e2e@archytas.local';
  v_pass    text := 'clientelocal123';
begin
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    v_user_id := gen_random_uuid();

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

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      v_user_id::text, v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  insert into public.profiles (id, nombre, rol)
  values (v_user_id, 'Cliente E2E', 'cliente')
  on conflict (id) do update set rol = 'cliente', nombre = 'Cliente E2E';

  insert into public.user_client_access (user_id, client_id)
  select v_user_id, id from public.clients where slug = 'bms'
  on conflict do nothing;

  raise notice 'Usuario cliente-e2e local listo: % (id %)', v_email, v_user_id;
end $$;
