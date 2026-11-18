-- =============================================================================
-- VahanKavach — Security & garage hardening
-- 30-day vehicle cache, lookup audit / quota, ownership flags, tightened RLS.
-- Additive on existing schema (does not recreate vehicles).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Enhance public.vehicles
-- ---------------------------------------------------------------------------

-- Allow transient (unowned) cache rows before chassis ownership verification.
ALTER TABLE public.vehicles
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS is_verified_owner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cached_until timestamptz;

-- Existing garage rows were claimed under the prior Protect flow — treat as verified.
UPDATE public.vehicles
SET is_verified_owner = true
WHERE user_id IS NOT NULL
  AND is_verified_owner = false;

-- Backfill cache window: prefer last_polled_at + 30d, else created_at + 30d, else now + 30d.
UPDATE public.vehicles
SET cached_until = COALESCE(
  last_polled_at + interval '30 days',
  created_at + interval '30 days',
  now() + interval '30 days'
)
WHERE cached_until IS NULL;

ALTER TABLE public.vehicles
  ALTER COLUMN cached_until SET DEFAULT (now() + interval '30 days');

ALTER TABLE public.vehicles
  ALTER COLUMN cached_until SET NOT NULL;

-- Keep chassis_last_5 (existing). Never rename — API maps chassisLast5 → chassis_last_5.
COMMENT ON COLUMN public.vehicles.chassis_last_5 IS
  'Last 5 alphanumeric characters of chassis only (zero-knowledge ownership proof). Full chassis/VIN must never be stored.';

COMMENT ON COLUMN public.vehicles.is_verified_owner IS
  'True only after caller proved chassis last-5 match against upstream RC.';

COMMENT ON COLUMN public.vehicles.cached_until IS
  'Upstream provider results are reused until this timestamp (default 30 days) to protect API balance.';

COMMENT ON COLUMN public.vehicles.user_id IS
  'Owner after verified claim. NULL = transient cache row (not attached to a garage).';

-- Re-assert registration format (idempotent).
ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_reg_number_format;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_reg_number_format CHECK (
    reg_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
  );

-- Soft assertion: refuse known PII / raw-vendor column names if ever added.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicles'
      AND column_name IN (
        'owner_address',
        'address',
        'residential_address',
        'mobile',
        'phone',
        'phone_number',
        'chassis_number',
        'full_chassis',
        'raw_payload',
        'vendor_json',
        'raw_vendor_json'
      )
  ) THEN
    RAISE EXCEPTION
      'public.vehicles must never store addresses, citizen phones, full chassis, or raw vendor JSON';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vehicles_cached_until_idx
  ON public.vehicles (cached_until);

CREATE INDEX IF NOT EXISTS vehicles_is_verified_owner_idx
  ON public.vehicles (user_id, is_verified_owner)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Audit / rate-limiting: public.vehicle_lookups
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vehicle_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reg_number text NOT NULL,
  is_cache_hit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_lookups_reg_number_format CHECK (
    reg_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
  )
);

COMMENT ON TABLE public.vehicle_lookups IS
  'Per-user vehicle lookup audit. Non-cache hits drive the daily anti-scraping quota.';

CREATE INDEX IF NOT EXISTS vehicle_lookups_user_created_idx
  ON public.vehicle_lookups (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vehicle_lookups_user_paid_window_idx
  ON public.vehicle_lookups (user_id, created_at DESC)
  WHERE is_cache_hit = false;

-- ---------------------------------------------------------------------------
-- 3) Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_lookups ENABLE ROW LEVEL SECURITY;

-- Replace broad owner ALL with explicit SELECT / INSERT / UPDATE (/ DELETE).
DROP POLICY IF EXISTS vehicles_owner_all ON public.vehicles;
DROP POLICY IF EXISTS vehicles_select_own ON public.vehicles;
DROP POLICY IF EXISTS vehicles_insert_own ON public.vehicles;
DROP POLICY IF EXISTS vehicles_update_own ON public.vehicles;
DROP POLICY IF EXISTS vehicles_delete_own ON public.vehicles;

CREATE POLICY vehicles_select_own
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY vehicles_insert_own
  ON public.vehicles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY vehicles_update_own
  ON public.vehicles
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY vehicles_delete_own
  ON public.vehicles
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Service role retains explicit full access (also has BYPASSRLS).
DROP POLICY IF EXISTS vehicles_service_role_all ON public.vehicles;
CREATE POLICY vehicles_service_role_all
  ON public.vehicles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS vehicle_lookups_select_own ON public.vehicle_lookups;
DROP POLICY IF EXISTS vehicle_lookups_service_role_all ON public.vehicle_lookups;

CREATE POLICY vehicle_lookups_select_own
  ON public.vehicle_lookups
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY vehicle_lookups_service_role_all
  ON public.vehicle_lookups
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.vehicle_lookups FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.vehicle_lookups FROM authenticated;
GRANT SELECT ON TABLE public.vehicle_lookups TO authenticated;
GRANT ALL ON TABLE public.vehicle_lookups TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Rate-limit stored procedure
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_user_lookup_quota(
  p_user_id uuid,
  p_max_daily integer DEFAULT 3
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max integer;
  v_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  v_max := GREATEST(COALESCE(p_max_daily, 3), 0);

  SELECT count(*)::integer
  INTO v_count
  FROM public.vehicle_lookups AS vl
  WHERE vl.user_id = p_user_id
    AND vl.is_cache_hit = false
    AND vl.created_at > (now() - interval '24 hours');

  RETURN v_count < v_max;
END;
$$;

COMMENT ON FUNCTION public.check_user_lookup_quota(uuid, integer) IS
  'Returns true when the user still has paid (non-cache) vehicle lookups left in the rolling 24h window.';

REVOKE ALL ON FUNCTION public.check_user_lookup_quota(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_user_lookup_quota(uuid, integer) TO authenticated, service_role;
