-- Per-vehicle / per-credit pricing for all paid plans.
-- Ad-hoc ₹19 × qty credits · Fleet ₹99 × qty vehicles / 7d · Pro ₹399 × qty / yr.

UPDATE public.plans
SET
  price_paise = 1900,
  duration_days = NULL,
  scan_credits_granted = 1,
  max_vehicles = NULL,
  allows_live_sync = true,
  unlimited_live_sync_while_active = false,
  description = '₹19 per credit. Each credit powers one live VAHAN + challan sync.',
  updated_at = now()
WHERE tier = 'adhoc_audit';

UPDATE public.plans
SET
  price_paise = 9900,
  duration_days = 7,
  scan_credits_granted = 0,
  max_vehicles = NULL,
  allows_live_sync = true,
  unlimited_live_sync_while_active = true,
  description = '₹99 per vehicle for 7 days. Burst live sync while the window is active.',
  updated_at = now()
WHERE tier = 'fleet_pass';

UPDATE public.plans
SET
  price_paise = 39900,
  duration_days = 365,
  scan_credits_granted = 37,
  max_vehicles = NULL,
  allows_live_sync = true,
  unlimited_live_sync_while_active = true,
  description = '₹399 per vehicle / year. Challan checked every 10 days; alert when a new challan is found.',
  updated_at = now()
WHERE tier = 'pro_annual';

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
  credits_to_add integer;
  next_max_vehicles integer;
BEGIN
  IF p_tier = 'free' THEN
    RAISE EXCEPTION 'Cannot purchase free tier';
  END IF;

  SELECT * INTO plan FROM public.plans WHERE tier = p_tier;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown plan tier %', p_tier;
  END IF;

  qty := GREATEST(COALESCE(p_vehicle_qty, 1), 1);
  credits_to_add := GREATEST(COALESCE(plan.scan_credits_granted, 0), 0) * qty;
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

  -- Seat count comes from purchase qty (catalog max_vehicles is NULL for paid tiers).
  next_max_vehicles := GREATEST(qty, COALESCE(row.max_vehicles, 0));

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
    scan_credits_balance = scan_credits_balance + credits_to_add,
    max_vehicles = next_max_vehicles,
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
      qty,
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

COMMENT ON FUNCTION public.grant_plan_purchase(uuid, public.subscription_tier, uuid, integer) IS
  'Apply a paid plan purchase. Ad-hoc grants scan_credits_granted × qty; '
  'fleet/pro set max_vehicles from purchase qty and open/extend the tier window.';
