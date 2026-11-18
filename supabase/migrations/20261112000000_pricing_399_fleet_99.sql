-- Pricing ladder: Ad-hoc ₹19 · Fleet ₹99/7d · Pro ₹399/yr
-- Pro: scheduled challan checks every 10 days (~37/yr backup credits).

UPDATE public.plans
SET
  price_paise = 1900,
  duration_days = NULL,
  scan_credits_granted = 1,
  max_vehicles = 1,
  allows_live_sync = true,
  unlimited_live_sync_while_active = false,
  description = 'Single paid live VAHAN + challan sync (₹19). Consumes 1 scan credit.',
  updated_at = now()
WHERE tier = 'adhoc_audit';

UPDATE public.plans
SET
  price_paise = 9900,
  duration_days = 7,
  scan_credits_granted = 10,
  max_vehicles = 10,
  allows_live_sync = true,
  unlimited_live_sync_while_active = true,
  description = '₹99 for 7 days. Burst live sync for up to 10 vehicles while active.',
  updated_at = now()
WHERE tier = 'fleet_pass';

UPDATE public.plans
SET
  price_paise = 39900,
  duration_days = 365,
  scan_credits_granted = 37,
  max_vehicles = 3,
  allows_live_sync = true,
  unlimited_live_sync_while_active = true,
  description = '₹399/year. Challan checked every 10 days; alert when a new challan is found. RC/PUC/insurance cached at onboard + on expiry.',
  updated_at = now()
WHERE tier = 'pro_annual';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'amount'
  ) THEN
    EXECUTE 'ALTER TABLE public.orders ALTER COLUMN amount SET DEFAULT 399.00';
    EXECUTE $c$
      COMMENT ON COLUMN public.orders.amount IS
        'Order total in INR rupees. Kavach Pro = ₹399 × vehicle_qty (annual prepaid).'
    $c$;
  END IF;
END $$;
