-- Security & compliance hardening (PCI / privilege escalation / RPC lockdown).
-- 1) Stop client forging of payment_attempts, is_pro, vehicle cost columns
-- 2) Lock billing/quota SECURITY DEFINER RPCs to service_role

-- ---------------------------------------------------------------------------
-- payment_attempts: service_role writes only (authenticated SELECT)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS payment_attempts_owner_insert ON public.payment_attempts;
DROP POLICY IF EXISTS payment_attempts_owner_update ON public.payment_attempts;
DROP POLICY IF EXISTS payment_attempts_owner_insert_created ON public.payment_attempts;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_attempts FROM authenticated;
GRANT SELECT ON TABLE public.payment_attempts TO authenticated;

-- ---------------------------------------------------------------------------
-- profiles: authenticated cannot set is_pro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF tg_op = 'INSERT' THEN
    NEW.is_pro := false;
  ELSIF tg_op = 'UPDATE' THEN
    NEW.is_pro := OLD.is_pro;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_billing ON public.profiles;
CREATE TRIGGER profiles_protect_billing
  BEFORE INSERT OR UPDATE OF is_pro ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_billing_columns();

-- ---------------------------------------------------------------------------
-- vehicles: authenticated cannot rewrite cache / ownership / linkage flags
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_vehicle_cost_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF tg_op = 'INSERT' THEN
    NEW.is_verified_owner := false;
    NEW.last_polled_at := NULL;
    NEW.cached_until := now() + interval '30 days';
    NEW.rc_mobile_linked := COALESCE(NEW.rc_mobile_linked, true);
    NEW.rc_aadhaar_linked := COALESCE(NEW.rc_aadhaar_linked, true);
    NEW.rc_contact_warning := COALESCE(NEW.rc_contact_warning, false);
    NEW.contact_audit_notified := false;
  ELSIF tg_op = 'UPDATE' THEN
    NEW.is_verified_owner := OLD.is_verified_owner;
    NEW.cached_until := OLD.cached_until;
    NEW.last_polled_at := OLD.last_polled_at;
    NEW.user_id := OLD.user_id;
    NEW.rc_mobile_linked := OLD.rc_mobile_linked;
    NEW.rc_aadhaar_linked := OLD.rc_aadhaar_linked;
    NEW.rc_contact_warning := OLD.rc_contact_warning;
    NEW.contact_audit_notified := OLD.contact_audit_notified;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_protect_cost_columns ON public.vehicles;
CREATE TRIGGER vehicles_protect_cost_columns
  BEFORE INSERT OR UPDATE ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_vehicle_cost_columns();

-- ---------------------------------------------------------------------------
-- challans: clients cannot forge paid status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_challan_payment_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF tg_op = 'INSERT' THEN
    NEW.status := COALESCE(NEW.status, 'UNPAID');
    IF NEW.status IN ('PAID_VIA_APP', 'PAID_EXTERNALLY') THEN
      NEW.status := 'UNPAID';
    END IF;
    NEW.payment_ref := NULL;
  ELSIF tg_op = 'UPDATE' THEN
    NEW.status := OLD.status;
    NEW.payment_ref := OLD.payment_ref;
    NEW.amount := OLD.amount;
    NEW.challan_number := OLD.challan_number;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS challans_protect_payment_columns ON public.challans;
CREATE TRIGGER challans_protect_payment_columns
  BEFORE INSERT OR UPDATE ON public.challans
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_challan_payment_columns();

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER RPC lockdown (service_role only where Edge uses admin)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ensure_user_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_entitlement(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.check_user_lookup_quota(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_lookup_quota(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.get_effective_subscription_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_subscription_tier(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.grant_plan_purchase(uuid, public.subscription_tier, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_plan_purchase(uuid, public.subscription_tier, uuid, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_payment_successful(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payment_successful(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.assert_and_consume_live_sync(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_and_consume_live_sync(uuid) TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_grant_user_entitlements'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_grant_user_entitlements(uuid, integer, text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_grant_user_entitlements(uuid, integer, text) TO service_role';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_vehicle_entitled'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.is_vehicle_entitled(uuid) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_vehicle_entitled(uuid) TO service_role';
  END IF;
END $$;

-- Bind chassis lockout to caller when authenticated
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
  IF auth.role() = 'authenticated' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*)::integer, min(a.created_at)
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

REVOKE ALL ON FUNCTION public.chassis_claim_lockout_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chassis_claim_lockout_status(uuid, text)
  TO authenticated, service_role;
