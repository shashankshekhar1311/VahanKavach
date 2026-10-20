-- VahanKavach Module 1: database schema, RLS, and signup/updated_at triggers.
-- Applied by `supabase db reset` / `supabase migration up`.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE public.fuel_type AS ENUM (
  'PETROL',
  'DIESEL',
  'CNG',
  'ELECTRIC',
  'HYBRID',
  'OTHER'
);

CREATE TYPE public.challan_status AS ENUM (
  'UNPAID',
  'PAID_EXTERNALLY',
  'PAID_VIA_APP',
  'DISPUTED'
);

COMMENT ON TYPE public.fuel_type IS 'Normalized fuel type from VAHAN / Surepass RC data.';
COMMENT ON TYPE public.challan_status IS 'E-challan lifecycle. PAID_EXTERNALLY is a portal payment; PAID_VIA_APP is a VahanKavach payment.';

-- ---------------------------------------------------------------------------
-- Utility triggers
-- ---------------------------------------------------------------------------

-- Stamps updated_at on every UPDATE. Shared by profiles, vehicles, and challans.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Strips separators and uppercases Indian registration numbers before CHECK.
-- "ka-01 ab 1234" is stored as "KA01AB1234".
CREATE OR REPLACE FUNCTION public.normalize_vehicle_registration()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.reg_number IS NOT NULL THEN
    NEW.reg_number := upper(regexp_replace(NEW.reg_number, '[^A-Za-z0-9]', '', 'g'));
  END IF;

  IF NEW.chassis_last_5 IS NOT NULL THEN
    NEW.chassis_last_5 := upper(regexp_replace(NEW.chassis_last_5, '[^A-Za-z0-9]', '', 'g'));
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- profiles.id is the auth.users id (1:1 extension). A gen_random_uuid() default
-- would not exist in auth.users and would fail the foreign key. vehicles and
-- challans use gen_random_uuid() because they are not auth identities.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  phone_number text,
  full_name text,
  city text,
  is_pro boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_phone_number_e164 CHECK (
    phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$'
  )
);

COMMENT ON TABLE public.profiles IS 'Application profile extending auth.users. id = auth.uid().';
COMMENT ON COLUMN public.profiles.phone_number IS 'E.164 phone, e.g. +919876543210. WhatsApp Cloud API identity.';
COMMENT ON COLUMN public.profiles.is_pro IS 'Paid VahanKavach plan flag. Default false.';

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reg_number text NOT NULL,
  chassis_last_5 text,
  maker_model text,
  fuel_type public.fuel_type,
  puc_expiry_date date,
  insurance_expiry_date date,
  fitness_expiry_date date,
  fastag_status text,
  fastag_bank text,
  last_polled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_reg_number_format CHECK (
    reg_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
  ),
  CONSTRAINT vehicles_chassis_last_5_format CHECK (
    chassis_last_5 IS NULL OR chassis_last_5 ~ '^[A-Z0-9]{5}$'
  )
);

COMMENT ON TABLE public.vehicles IS 'Vehicles owned by a profile. Registration numbers are stored uppercase without separators.';
COMMENT ON COLUMN public.vehicles.reg_number IS 'Indian registration, e.g. KA01AB1234.';
COMMENT ON COLUMN public.vehicles.puc_expiry_date IS 'PUC valid-until date. Indexed for expiry sweeps.';
COMMENT ON COLUMN public.vehicles.last_polled_at IS 'Last successful VAHAN / e-challan poll.';

CREATE TABLE public.challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  challan_number text NOT NULL,
  amount numeric(10, 2) NOT NULL,
  violation_date timestamptz,
  violation_type text,
  location text,
  evidence_url text,
  status public.challan_status NOT NULL DEFAULT 'UNPAID',
  payment_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challans_amount_non_negative CHECK (amount >= 0),
  CONSTRAINT challans_challan_number_not_blank CHECK (length(btrim(challan_number)) > 0)
);

COMMENT ON TABLE public.challans IS 'E-challans for a vehicle. Access is derived from vehicles.user_id.';
COMMENT ON COLUMN public.challans.payment_ref IS 'Gateway or portal reference once the challan is paid.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Unique btree index requested for phone lookups (WhatsApp inbound routing).
CREATE UNIQUE INDEX profiles_phone_number_idx
  ON public.profiles USING btree (phone_number);

CREATE UNIQUE INDEX vehicles_reg_number_idx
  ON public.vehicles USING btree (reg_number);

CREATE INDEX vehicles_user_id_idx
  ON public.vehicles USING btree (user_id);

CREATE INDEX vehicles_puc_expiry_date_idx
  ON public.vehicles USING btree (puc_expiry_date);

CREATE UNIQUE INDEX challans_challan_number_idx
  ON public.challans USING btree (challan_number);

CREATE INDEX challans_vehicle_id_idx
  ON public.challans USING btree (vehicle_id);

CREATE INDEX challans_status_idx
  ON public.challans USING btree (status);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER vehicles_normalize_registration
  BEFORE INSERT OR UPDATE OF reg_number, chassis_last_5 ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_vehicle_registration();

CREATE TRIGGER vehicles_set_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER challans_set_updated_at
  BEFORE UPDATE ON public.challans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Signup: copy auth.users into public.profiles
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, phone_number, full_name)
  VALUES (
    NEW.id,
    NULLIF(NEW.raw_user_meta_data ->> 'phone_number', ''),
    NULLIF(
      COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name'
      ),
      ''
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS 'Inserts public.profiles when auth.users gains a row. Reads full_name and phone_number from raw_user_meta_data.';

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Trigger functions are not part of the public API.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_vehicle_registration() FROM PUBLIC;

-- GoTrue inserts auth.users as supabase_auth_admin, which must be allowed to fire the trigger.
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- Row writers fire the BEFORE triggers, so they need EXECUTE on those functions.
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_vehicle_registration() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challans ENABLE ROW LEVEL SECURITY;

-- Owners: auth.uid() = profiles.id, vehicles.user_id, or the parent vehicle's user_id.
CREATE POLICY profiles_owner_all
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY vehicles_owner_all
  ON public.vehicles
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY challans_owner_all
  ON public.challans
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vehicles AS v
      WHERE v.id = challans.vehicle_id
        AND v.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vehicles AS v
      WHERE v.id = challans.vehicle_id
        AND v.user_id = auth.uid()
    )
  );

-- service_role is used by Edge Functions and pg_cron workers.
-- The role also has BYPASSRLS; these policies keep access explicit if that privilege changes.
CREATE POLICY profiles_service_role_all
  ON public.profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY vehicles_service_role_all
  ON public.vehicles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY challans_service_role_all
  ON public.challans
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Privileges
-- Supabase grants new public tables to anon by default. This app is authenticated-only.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.vehicles FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.challans FROM PUBLIC, anon;

REVOKE ALL ON TABLE public.profiles FROM authenticated;
REVOKE ALL ON TABLE public.vehicles FROM authenticated;
REVOKE ALL ON TABLE public.challans FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.challans TO authenticated;

GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.vehicles TO service_role;
GRANT ALL ON TABLE public.challans TO service_role;

NOTIFY pgrst, 'reload schema';
