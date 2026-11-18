-- =============================================================================
-- VahanKavach — Multi-tier plans, scan credits, UPI payment ledger
-- Tiers: free | adhoc_audit (₹19) | fleet_pass (₹99/7d) | pro_annual (₹399/yr)
-- Note: prices re-asserted in 20261112000000_pricing_399_fleet_99.sql
-- Free = manual date tracking only (zero upstream API cost).
-- Paid live VAHAN/challan sync requires active tier window OR scan credit.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Custom types
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE TYPE public.subscription_tier AS ENUM (
    'free',
    'adhoc_audit',
    'pro_annual',
    'fleet_pass'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE public.subscription_tier IS
  'Product tiers. free = manual tracking only; paid tiers unlock live sync.';

-- public.payment_status already exists (PENDING/SUCCESS/FAILED from orders).
-- Extend it and add a lowercase gateway alias type for the new payments ledger.
DO $$
BEGIN
  ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'REFUNDED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.gateway_payment_status AS ENUM (
    'pending',
    'successful',
    'failed',
    'refunded'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE public.gateway_payment_status IS
  'UPI gateway callback status (Cashfree / Razorpay / UPI intent). '
  'Distinct from legacy public.payment_status used by public.orders.';

DO $$
BEGIN
  CREATE TYPE public.payment_provider AS ENUM (
    'razorpay',
    'cashfree',
    'upi_intent'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Plan catalog
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plans (
  tier public.subscription_tier PRIMARY KEY,
  display_name text NOT NULL,
  price_paise integer NOT NULL CHECK (price_paise >= 0),
  duration_days integer CHECK (duration_days IS NULL OR duration_days > 0),
  scan_credits_granted integer NOT NULL DEFAULT 0 CHECK (scan_credits_granted >= 0),
  max_vehicles integer CHECK (max_vehicles IS NULL OR max_vehicles > 0),
  allows_live_sync boolean NOT NULL DEFAULT false,
  unlimited_live_sync_while_active boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plans IS
  'Immutable-ish product catalog. Price in paise. duration_days NULL = no expiry window.';

INSERT INTO public.plans AS p (
  tier,
  display_name,
  price_paise,
  duration_days,
  scan_credits_granted,
  max_vehicles,
  allows_live_sync,
  unlimited_live_sync_while_active,
  description
) VALUES
  (
    'free',
    'Free Garage',
    0,
    NULL,
    0,
    5,
    false,
    false,
    'Manual PUC / insurance / fitness date tracking. Zero upstream API cost.'
  ),
  (
    'adhoc_audit',
    'Ad-hoc Audit',
    1900,
    NULL,
    1,
    1,
    true,
    false,
    'Single paid live VAHAN + challan sync (₹19). Consumes 1 scan credit.'
  ),
  (
    'pro_annual',
    'Kavach Pro Annual',
    39900,
    365,
    37,
    3,
    true,
    true,
    '₹399/year. Challan checked every 10 days; alert when a new challan is found. RC/PUC/insurance cached at onboard + on expiry.'
  ),
  (
    'fleet_pass',
    'Fleet Pass',
    9900,
    7,
    10,
    10,
    true,
    true,
    '₹99 for 7 days. Burst live sync for up to 10 vehicles while active.'
  )
ON CONFLICT (tier) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  price_paise = EXCLUDED.price_paise,
  duration_days = EXCLUDED.duration_days,
  scan_credits_granted = EXCLUDED.scan_credits_granted,
  max_vehicles = EXCLUDED.max_vehicles,
  allows_live_sync = EXCLUDED.allows_live_sync,
  unlimited_live_sync_while_active = EXCLUDED.unlimited_live_sync_while_active,
  description = EXCLUDED.description,
  updated_at = now();

DROP TRIGGER IF EXISTS plans_set_updated_at ON public.plans;
CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Per-user entitlement + scan credit wallet
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  tier public.subscription_tier NOT NULL DEFAULT 'free',
  scan_credits_balance integer NOT NULL DEFAULT 0
    CHECK (scan_credits_balance >= 0),
  tier_expires_at timestamptz,
  max_vehicles integer,
  last_payment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_entitlements IS
  'Effective plan + scan credit wallet. Free users track dates manually; '
  'live sync requires active unlimited window or scan_credits_balance > 0.';

COMMENT ON COLUMN public.user_entitlements.scan_credits_balance IS
  'Paid upstream sync tokens. Decremented atomically before provider calls.';

COMMENT ON COLUMN public.user_entitlements.tier_expires_at IS
  'NULL for free / adhoc credit packs. Set for pro_annual and fleet_pass windows.';

CREATE INDEX IF NOT EXISTS user_entitlements_tier_expires_idx
  ON public.user_entitlements (tier_expires_at)
  WHERE tier_expires_at IS NOT NULL;

DROP TRIGGER IF EXISTS user_entitlements_set_updated_at ON public.user_entitlements;
CREATE TRIGGER user_entitlements_set_updated_at
  BEFORE UPDATE ON public.user_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Seed free entitlements for existing profiles.
INSERT INTO public.user_entitlements (user_id, tier, scan_credits_balance, max_vehicles)
SELECT p.id, 'free'::public.subscription_tier, 0, 5
FROM public.profiles AS p
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) UPI / gateway payments ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  tier public.subscription_tier NOT NULL,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR',
  status public.gateway_payment_status NOT NULL DEFAULT 'pending',
  provider public.payment_provider NOT NULL DEFAULT 'razorpay',
  provider_order_id text,
  provider_payment_id text,
  provider_signature text,
  vehicle_qty integer CHECK (vehicle_qty IS NULL OR vehicle_qty > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_currency_not_blank CHECK (length(btrim(currency)) > 0)
);

COMMENT ON TABLE public.payments IS
  'UPI gateway payment attempts/callbacks (Cashfree / Razorpay). '
  'Service role writes on webhook; users may read their own rows.';

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_order_uidx
  ON public.payments (provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_user_created_idx
  ON public.payments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_status_idx
  ON public.payments (status);

DROP TRIGGER IF EXISTS payments_set_updated_at ON public.payments;
CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_entitlements
  DROP CONSTRAINT IF EXISTS user_entitlements_last_payment_id_fkey;

ALTER TABLE public.user_entitlements
  ADD CONSTRAINT user_entitlements_last_payment_id_fkey
  FOREIGN KEY (last_payment_id) REFERENCES public.payments (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5) Free-tier manual date tracking (zero upstream API cost)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vehicle_manual_dates (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  puc_expiry_date date,
  insurance_expiry_date date,
  fitness_expiry_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vehicle_manual_dates IS
  'User-entered compliance dates for free tier. Never triggers paid VAHAN calls.';

CREATE INDEX IF NOT EXISTS vehicle_manual_dates_user_idx
  ON public.vehicle_manual_dates (user_id);

DROP TRIGGER IF EXISTS vehicle_manual_dates_set_updated_at ON public.vehicle_manual_dates;
CREATE TRIGGER vehicle_manual_dates_set_updated_at
  BEFORE UPDATE ON public.vehicle_manual_dates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Widen vehicle_entitlements.source for new plan grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.vehicle_entitlements
  DROP CONSTRAINT IF EXISTS vehicle_entitlements_source_check;

ALTER TABLE public.vehicle_entitlements
  ADD CONSTRAINT vehicle_entitlements_source_check CHECK (
    source IN (
      'trial',
      'subscription',
      'admin_grant',
      'adhoc_audit',
      'pro_annual',
      'fleet_pass'
    )
  );

-- ---------------------------------------------------------------------------
-- 7) Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_manual_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_select_authenticated ON public.plans;
CREATE POLICY plans_select_authenticated
  ON public.plans
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS plans_service_role_all ON public.plans;
CREATE POLICY plans_service_role_all
  ON public.plans
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS user_entitlements_select_own ON public.user_entitlements;
CREATE POLICY user_entitlements_select_own
  ON public.user_entitlements
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_entitlements_service_role_all ON public.user_entitlements;
CREATE POLICY user_entitlements_service_role_all
  ON public.user_entitlements
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS payments_select_own ON public.payments;
CREATE POLICY payments_select_own
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS payments_service_role_all ON public.payments;
CREATE POLICY payments_service_role_all
  ON public.payments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS vehicle_manual_dates_owner_all ON public.vehicle_manual_dates;
CREATE POLICY vehicle_manual_dates_owner_all
  ON public.vehicle_manual_dates
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS vehicle_manual_dates_service_role_all ON public.vehicle_manual_dates;
CREATE POLICY vehicle_manual_dates_service_role_all
  ON public.vehicle_manual_dates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.plans FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.user_entitlements FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.payments FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.vehicle_manual_dates FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.plans TO authenticated;
GRANT SELECT ON TABLE public.user_entitlements TO authenticated;
GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_manual_dates TO authenticated;

GRANT ALL ON TABLE public.plans TO service_role;
GRANT ALL ON TABLE public.user_entitlements TO service_role;
GRANT ALL ON TABLE public.payments TO service_role;
GRANT ALL ON TABLE public.vehicle_manual_dates TO service_role;

-- ---------------------------------------------------------------------------
-- 8) DB functions — effective tier, live-sync gate, plan grant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_user_entitlement(p_user_id uuid)
RETURNS public.user_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.user_entitlements;
BEGIN
  INSERT INTO public.user_entitlements (user_id, tier, scan_credits_balance, max_vehicles)
  VALUES (p_user_id, 'free', 0, 5)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO row FROM public.user_entitlements WHERE user_id = p_user_id;
  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_subscription_tier(p_user_id uuid)
RETURNS public.subscription_tier
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.user_entitlements;
BEGIN
  row := public.ensure_user_entitlement(p_user_id);

  IF row.tier IN ('pro_annual', 'fleet_pass') THEN
    IF row.tier_expires_at IS NOT NULL AND row.tier_expires_at > now() THEN
      RETURN row.tier;
    END IF;
    RETURN 'free'::public.subscription_tier;
  END IF;

  IF row.tier = 'adhoc_audit' AND row.scan_credits_balance > 0 THEN
    RETURN 'adhoc_audit'::public.subscription_tier;
  END IF;

  RETURN 'free'::public.subscription_tier;
END;
$$;

/**
 * Atomically authorize a paid upstream sync.
 * Returns true when:
 *   - pro_annual / fleet_pass window is active (unlimited, no credit burn), OR
 *   - scan_credits_balance was > 0 and was decremented by 1.
 */
CREATE OR REPLACE FUNCTION public.assert_and_consume_live_sync(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.user_entitlements;
  plan public.plans;
BEGIN
  PERFORM public.ensure_user_entitlement(p_user_id);

  SELECT * INTO row
  FROM public.user_entitlements
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Active Pro / Fleet window → unlimited live sync (no credit burn).
  IF row.tier IN ('pro_annual', 'fleet_pass')
     AND row.tier_expires_at IS NOT NULL
     AND row.tier_expires_at > now() THEN
    SELECT * INTO plan FROM public.plans WHERE tier = row.tier;
    IF FOUND AND plan.unlimited_live_sync_while_active THEN
      RETURN true;
    END IF;
  END IF;

  -- Ad-hoc / leftover credits → burn one token.
  IF row.scan_credits_balance > 0 THEN
    UPDATE public.user_entitlements
    SET
      scan_credits_balance = scan_credits_balance - 1,
      updated_at = now()
    WHERE user_id = p_user_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_plan_purchase(
  p_user_id uuid,
  p_tier public.subscription_tier,
  p_payment_id uuid DEFAULT NULL,
  p_vehicle_qty integer DEFAULT 1
)
RETURNS public.user_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  plan public.plans;
  row public.user_entitlements;
  new_expires timestamptz;
  qty integer;
BEGIN
  IF p_tier = 'free' THEN
    RAISE EXCEPTION 'Cannot purchase free tier';
  END IF;

  SELECT * INTO plan FROM public.plans WHERE tier = p_tier;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown plan tier %', p_tier;
  END IF;

  qty := GREATEST(COALESCE(p_vehicle_qty, 1), 1);
  PERFORM public.ensure_user_entitlement(p_user_id);

  SELECT * INTO row
  FROM public.user_entitlements
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF plan.duration_days IS NOT NULL THEN
    IF row.tier = p_tier
       AND row.tier_expires_at IS NOT NULL
       AND row.tier_expires_at > now() THEN
      new_expires := row.tier_expires_at + make_interval(days => plan.duration_days);
    ELSE
      new_expires := now() + make_interval(days => plan.duration_days);
    END IF;
  ELSE
    new_expires := row.tier_expires_at;
  END IF;

  UPDATE public.user_entitlements
  SET
    tier = CASE
      WHEN p_tier IN ('pro_annual', 'fleet_pass') THEN p_tier
      WHEN row.tier IN ('pro_annual', 'fleet_pass')
           AND row.tier_expires_at IS NOT NULL
           AND row.tier_expires_at > now() THEN row.tier
      ELSE p_tier
    END,
    tier_expires_at = CASE
      WHEN p_tier IN ('pro_annual', 'fleet_pass') THEN new_expires
      ELSE row.tier_expires_at
    END,
    scan_credits_balance = scan_credits_balance + plan.scan_credits_granted,
    max_vehicles = COALESCE(plan.max_vehicles, row.max_vehicles, qty),
    last_payment_id = COALESCE(p_payment_id, last_payment_id),
    updated_at = now()
  WHERE user_id = p_user_id
  RETURNING * INTO row;

  -- Keep legacy subscriptions / is_pro in sync for Pro annual.
  IF p_tier = 'pro_annual' THEN
    UPDATE public.profiles
    SET is_pro = true, updated_at = now()
    WHERE id = p_user_id;

    INSERT INTO public.subscriptions AS s (
      user_id,
      status,
      current_period_start,
      current_period_end,
      vehicle_qty,
      amount_paise_per_vehicle
    ) VALUES (
      p_user_id,
      'active',
      now(),
      new_expires,
      GREATEST(qty, COALESCE(plan.max_vehicles, 1)),
      plan.price_paise
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
      status = 'active',
      current_period_start = now(),
      current_period_end = EXCLUDED.current_period_end,
      vehicle_qty = GREATEST(s.vehicle_qty, EXCLUDED.vehicle_qty),
      amount_paise_per_vehicle = EXCLUDED.amount_paise_per_vehicle,
      updated_at = now();

    UPDATE public.vehicle_entitlements
    SET
      active_until = new_expires,
      source = 'pro_annual',
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSIF p_tier = 'fleet_pass' THEN
    UPDATE public.vehicle_entitlements
    SET
      active_until = GREATEST(active_until, new_expires),
      source = 'fleet_pass',
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_payment_successful(
  p_payment_id uuid,
  p_provider_payment_id text DEFAULT NULL,
  p_provider_signature text DEFAULT NULL
)
RETURNS public.user_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments;
  entitled public.user_entitlements;
BEGIN
  UPDATE public.payments
  SET
    status = 'successful',
    provider_payment_id = COALESCE(p_provider_payment_id, provider_payment_id),
    provider_signature = COALESCE(p_provider_signature, provider_signature),
    updated_at = now()
  WHERE id = p_payment_id
    AND status IN ('pending', 'failed')
  RETURNING * INTO pay;

  IF NOT FOUND THEN
    SELECT * INTO pay FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment % not found', p_payment_id;
    END IF;
    -- Idempotent: already successful.
    RETURN public.ensure_user_entitlement(pay.user_id);
  END IF;

  entitled := public.grant_plan_purchase(
    pay.user_id,
    pay.tier,
    pay.id,
    COALESCE(pay.vehicle_qty, 1)
  );

  RETURN entitled;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_entitlement(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_effective_subscription_tier(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_and_consume_live_sync(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_plan_purchase(uuid, public.subscription_tier, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_payment_successful(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ensure_user_entitlement(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_subscription_tier(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_and_consume_live_sync(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_plan_purchase(uuid, public.subscription_tier, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_payment_successful(uuid, text, text) TO service_role;

-- Align legacy orders default with Pro annual ₹399.
ALTER TABLE public.orders
  ALTER COLUMN amount SET DEFAULT 399.00;

COMMENT ON COLUMN public.orders.amount IS
  'Order total in INR rupees. Kavach Pro = ₹399 × vehicle_qty (annual prepaid).';
