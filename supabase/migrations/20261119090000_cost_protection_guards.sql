-- Cost-protection: Bharat-series plates, 24h negative RC cache, chassis lockout helper.

-- ---------------------------------------------------------------------------
-- 1) Allow Bharat Series (e.g. 22BH1234AA) alongside classic RTO plates
-- ---------------------------------------------------------------------------

ALTER TABLE public.vehicle_claim_attempts
  DROP CONSTRAINT IF EXISTS vehicle_claim_attempts_reg_format;

ALTER TABLE public.vehicle_claim_attempts
  ADD CONSTRAINT vehicle_claim_attempts_reg_format CHECK (
    reg_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
    OR reg_number ~ '^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$'
  );

ALTER TABLE public.vehicle_lookups
  DROP CONSTRAINT IF EXISTS vehicle_lookups_reg_number_format;

ALTER TABLE public.vehicle_lookups
  ADD CONSTRAINT vehicle_lookups_reg_number_format CHECK (
    reg_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
    OR reg_number ~ '^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$'
  );

-- vehicles.reg_number may already have a format check from init — relax if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicles_reg_number_format'
      AND conrelid = 'public.vehicles'::regclass
  ) THEN
    ALTER TABLE public.vehicles DROP CONSTRAINT vehicles_reg_number_format;
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_reg_number_format CHECK (
        reg_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
        OR reg_number ~ '^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$'
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) 24h negative cache for INVALID_RC / NO_MATCH (prevents Deepvue re-spend)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rc_negative_lookups (
  reg_number text PRIMARY KEY,
  reason text NOT NULL DEFAULT 'INVALID_RC_NUMBER',
  provider_sub_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT rc_negative_lookups_reg_format CHECK (
    reg_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
    OR reg_number ~ '^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$'
  )
);

COMMENT ON TABLE public.rc_negative_lookups IS
  'Negative RC cache: syntactically valid plates that VAHAN reported missing. TTL 24h — no Deepvue re-call while fresh.';

CREATE INDEX IF NOT EXISTS rc_negative_lookups_expires_idx
  ON public.rc_negative_lookups (expires_at);

ALTER TABLE public.rc_negative_lookups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rc_negative_lookups_service_role_all ON public.rc_negative_lookups;
CREATE POLICY rc_negative_lookups_service_role_all
  ON public.rc_negative_lookups
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.rc_negative_lookups FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rc_negative_lookups TO service_role;

CREATE OR REPLACE FUNCTION public.get_fresh_rc_negative(p_reg_number text)
RETURNS public.rc_negative_lookups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.rc_negative_lookups;
BEGIN
  SELECT * INTO row
  FROM public.rc_negative_lookups
  WHERE reg_number = upper(trim(p_reg_number))
    AND expires_at > now();
  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_rc_negative(
  p_reg_number text,
  p_reason text DEFAULT 'INVALID_RC_NUMBER',
  p_sub_code text DEFAULT NULL,
  p_ttl_hours integer DEFAULT 24
)
RETURNS public.rc_negative_lookups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.rc_negative_lookups;
  ttl integer := GREATEST(COALESCE(p_ttl_hours, 24), 1);
BEGIN
  INSERT INTO public.rc_negative_lookups AS n (
    reg_number,
    reason,
    provider_sub_code,
    created_at,
    expires_at
  ) VALUES (
    upper(trim(p_reg_number)),
    COALESCE(NULLIF(trim(p_reason), ''), 'INVALID_RC_NUMBER'),
    NULLIF(trim(p_sub_code), ''),
    now(),
    now() + make_interval(hours => ttl)
  )
  ON CONFLICT (reg_number) DO UPDATE
  SET
    reason = EXCLUDED.reason,
    provider_sub_code = EXCLUDED.provider_sub_code,
    created_at = now(),
    expires_at = now() + make_interval(hours => ttl)
  RETURNING * INTO row;
  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.get_fresh_rc_negative(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_rc_negative(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fresh_rc_negative(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_rc_negative(text, text, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Chassis 3-strike / 15-minute lockout status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.chassis_claim_lockout_status(
  p_user_id uuid,
  p_reg_number text
)
RETURNS TABLE (
  locked boolean,
  reject_count integer,
  attempts_remaining integer,
  retry_after_sec integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg text := upper(regexp_replace(trim(p_reg_number), '[^A-Z0-9]', '', 'g'));
  v_count integer := 0;
  v_oldest timestamptz;
  v_retry integer := 0;
BEGIN
  SELECT count(*)::integer,
         min(a.created_at)
  INTO v_count, v_oldest
  FROM public.vehicle_claim_attempts AS a
  WHERE a.user_id = p_user_id
    AND a.reg_number = v_reg
    AND a.outcome = 'rejected'
    AND a.created_at > (now() - interval '15 minutes');

  IF v_count >= 3 AND v_oldest IS NOT NULL THEN
    v_retry := GREATEST(
      1,
      ceil(extract(epoch FROM (v_oldest + interval '15 minutes' - now())))::integer
    );
    RETURN QUERY SELECT true, v_count, 0, v_retry;
  ELSE
    RETURN QUERY SELECT false, v_count, GREATEST(0, 3 - v_count), 0;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.chassis_claim_lockout_status(uuid, text) IS
  '3 wrong chassis attempts on the same plate within 15 minutes → locked until the window clears.';

REVOKE ALL ON FUNCTION public.chassis_claim_lockout_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chassis_claim_lockout_status(uuid, text) TO authenticated, service_role;
