-- Local seed for VahanKavach. Applied by `supabase start` (first boot) and `supabase db reset`.
-- Do not run this file against a hosted Supabase project; create users there with the Auth admin API.
--
-- Test login (local GoTrue only):
--   email:    aarav.mehta@vahankavach.test
--   password: TestPassword123!

BEGIN;

-- Fixed id so vehicles, challans, and tests can refer to the same user after every reset.
WITH new_user AS (
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    email_change_token_current,
    recovery_token,
    phone_change,
    phone_change_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'authenticated',
    'authenticated',
    'aarav.mehta@vahankavach.test',
    extensions.crypt('TestPassword123!', extensions.gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Aarav Mehta","phone_number":"+919876543210"}'::jsonb,
    now(),
    now()
  )
  RETURNING id, email
)
INSERT INTO auth.identities (
  id,
  user_id,
  provider,
  provider_id,
  identity_data,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  id,
  'email',
  id::text,
  jsonb_build_object(
    'sub', id::text,
    'email', email,
    'email_verified', true
  ),
  now(),
  now(),
  now()
FROM new_user;

-- The auth.users trigger already inserted the profile. Fill the fields it does not know.
INSERT INTO public.profiles (id, phone_number, full_name, city, is_pro, preferred_channel)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  '+919876543210',
  'Aarav Mehta',
  'Bengaluru',
  false,
  'TELEGRAM'
)
ON CONFLICT (id) DO UPDATE
SET
  phone_number = EXCLUDED.phone_number,
  full_name = EXCLUDED.full_name,
  city = EXCLUDED.city,
  is_pro = EXCLUDED.is_pro,
  preferred_channel = EXCLUDED.preferred_channel;

-- Module 4 alert fixtures (relative to CURRENT_DATE):
--   KA01AB1234  T-7 warning candidate
--   DL01EX0001  T-1 urgent candidate
--   TS09EX0002  expired-today candidate
--   MH12CD5678  far-future PUC + unpaid challans (non-alert)
INSERT INTO public.vehicles (
  id,
  user_id,
  reg_number,
  chassis_last_5,
  maker_model,
  fuel_type,
  puc_expiry_date,
  insurance_expiry_date,
  fitness_expiry_date,
  fastag_status,
  fastag_bank,
  last_polled_at
) VALUES
  (
    'b1111111-1111-4111-8111-111111111111',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'KA01AB1234',
    'A1B2C',
    'Maruti Suzuki Baleno',
    'PETROL',
    (CURRENT_DATE + 7),
    (CURRENT_DATE + 180),
    NULL,
    'ACTIVE',
    'HDFC Bank',
    now() - interval '2 hours'
  ),
  (
    'b2222222-2222-4222-8222-222222222222',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'MH12CD5678',
    'Z9Y8X',
    'Hyundai Creta',
    'DIESEL',
    (CURRENT_DATE + 120),
    (CURRENT_DATE + 40),
    NULL,
    'LOW_BALANCE',
    'ICICI Bank',
    now() - interval '2 hours'
  ),
  (
    'b3333333-3333-4333-8333-333333333333',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'DL01EX0001',
    'D1L0X',
    'Tata Nexon',
    'PETROL',
    (CURRENT_DATE + 1),
    (CURRENT_DATE + 90),
    NULL,
    'ACTIVE',
    'SBI',
    now() - interval '2 hours'
  ),
  (
    'b4444444-4444-4444-8444-444444444444',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'TS09EX0002',
    'T9S0X',
    'Honda City',
    'PETROL',
    CURRENT_DATE,
    (CURRENT_DATE + 60),
    NULL,
    'ACTIVE',
    'Axis Bank',
    now() - interval '2 hours'
  );

INSERT INTO public.challans (
  id,
  vehicle_id,
  challan_number,
  amount,
  violation_date,
  violation_type,
  location,
  evidence_url,
  status,
  payment_ref
) VALUES
  (
    'c3333333-3333-4333-8333-333333333331',
    'b2222222-2222-4222-8222-222222222222',
    'MH12CD56780001',
    2000.00,
    now() - interval '12 days',
    'Over Speeding',
    'Western Express Highway, Mumbai',
    NULL,
    'UNPAID',
    NULL
  ),
  (
    'c3333333-3333-4333-8333-333333333332',
    'b2222222-2222-4222-8222-222222222222',
    'MH12CD56780002',
    500.00,
    now() - interval '4 days',
    'Signal Jump',
    'Bandra West, Mumbai',
    NULL,
    'UNPAID',
    NULL
  );

COMMIT;
