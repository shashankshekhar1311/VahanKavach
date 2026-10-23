-- Module 2: DPDP Act 2023 consent audit, data minimization (engine_last_5),
-- and supporting RLS for self-serve erasure flows.
-- Note: timestamp 20260106000000 — 20260103000000 is already used by notification_channels.

-- ---------------------------------------------------------------------------
-- Data minimization: persist only last-5 of chassis / engine (never full VIN)
-- ---------------------------------------------------------------------------

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS engine_last_5 text;

ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_engine_last_5_format;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_engine_last_5_format CHECK (
    engine_last_5 IS NULL OR engine_last_5 ~ '^[A-Z0-9]{5}$'
  );

COMMENT ON COLUMN public.vehicles.chassis_last_5 IS
  'Last 5 alphanumeric characters of chassis only. Full chassis/VIN must never be stored.';
COMMENT ON COLUMN public.vehicles.engine_last_5 IS
  'Last 5 alphanumeric characters of engine number only. Full engine number must never be stored.';

-- Extend normalizer: uppercase + strip non-alnum for chassis_last_5 and engine_last_5.
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
    IF length(NEW.chassis_last_5) > 5 THEN
      NEW.chassis_last_5 := right(NEW.chassis_last_5, 5);
    END IF;
  END IF;

  IF NEW.engine_last_5 IS NOT NULL THEN
    NEW.engine_last_5 := upper(regexp_replace(NEW.engine_last_5, '[^A-Za-z0-9]', '', 'g'));
    IF length(NEW.engine_last_5) > 5 THEN
      NEW.engine_last_5 := right(NEW.engine_last_5, 5);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_normalize_registration ON public.vehicles;

CREATE TRIGGER vehicles_normalize_registration
  BEFORE INSERT OR UPDATE OF reg_number, chassis_last_5, engine_last_5
  ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_vehicle_registration();

-- Soft assertion: vehicles must not gain owner residential address columns.
-- (No owner_address / permanent_address columns are created by design.)

-- ---------------------------------------------------------------------------
-- Consent audit log (explicit purpose + text version + client metadata)
-- ---------------------------------------------------------------------------

CREATE TABLE public.consent_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  purpose text NOT NULL,
  consent_text_version text NOT NULL,
  ip_address text,
  user_agent text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_audit_logs_purpose_not_blank CHECK (length(btrim(purpose)) > 0),
  CONSTRAINT consent_audit_logs_version_not_blank CHECK (
    length(btrim(consent_text_version)) > 0
  )
);

COMMENT ON TABLE public.consent_audit_logs IS
  'DPDP Act 2023 consent records for VAHAN RC / challan monitoring. Immutable for end users.';
COMMENT ON COLUMN public.consent_audit_logs.purpose IS
  'Processing purpose code, e.g. VAHAN_RC_AND_CHALLAN_MONITORING.';
COMMENT ON COLUMN public.consent_audit_logs.consent_text_version IS
  'Version of the consent copy shown to the user, e.g. v1.0_2026.';

CREATE INDEX consent_audit_logs_user_granted_idx
  ON public.consent_audit_logs (user_id, granted_at DESC);

CREATE INDEX consent_audit_logs_vehicle_idx
  ON public.consent_audit_logs (vehicle_id);

ALTER TABLE public.consent_audit_logs ENABLE ROW LEVEL SECURITY;

-- Users may view only their own consent logs.
CREATE POLICY consent_audit_logs_owner_select
  ON public.consent_audit_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users may insert consent for themselves (and only for vehicles they own).
CREATE POLICY consent_audit_logs_owner_insert
  ON public.consent_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.vehicles v
      WHERE v.id = vehicle_id
        AND v.user_id = auth.uid()
    )
  );

-- service_role has full access (admin erasure, backfills, edge functions).
CREATE POLICY consent_audit_logs_service_role_all
  ON public.consent_audit_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.consent_audit_logs FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.consent_audit_logs TO authenticated;
GRANT ALL ON TABLE public.consent_audit_logs TO service_role;
