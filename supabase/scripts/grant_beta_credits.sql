-- =============================================================================
-- VahanKavach — Grant 3 free live-scan credits to invited beta testers
-- Run in: Supabase Dashboard → SQL Editor (as postgres / service role)
-- =============================================================================
--
-- HOW LIVE SYNC CREDITS WORK (no credit_ledger table exists)
-- ---------------------------------------------------------------------------
-- Gate path (sync-vehicle → billing/plans.ts):
--   1) assertLiveSyncAvailable(admin, userId)
--        → get_effective_subscription_tier(user)
--            OR ensure_user_entitlement → user_entitlements.scan_credits_balance > 0
--   2) After successful upstream RC fetch:
--        assertAndConsumeLiveSync → RPC public.assert_and_consume_live_sync(user)
--            → FOR UPDATE user_entitlements
--            → if active pro_annual/fleet_pass window: allow (no burn)
--            → else if scan_credits_balance > 0: decrement by 1, return true
--            → else return false → 402 LIVE_SYNC_PAYMENT_REQUIRED
--
-- Required write for beta (no Razorpay / no payments row / no FK to ledger):
--   public.user_entitlements
--     • user_id              → auth.users.id
--     • tier                 → 'adhoc_audit' (so effective tier shows credits)
--     • scan_credits_balance → at least 3
--     • max_vehicles         → 5 (free default) if inserting new row
--
-- profiles.is_pro is NOT used for live-sync gating (only daily lookup quota).
-- There is no public.credit_ledger table — do not invent ledger inserts.
--
-- PREREQUISITE
-- ---------------------------------------------------------------------------
-- Testers must already exist in auth.users (Invite user in Auth dashboard, or
-- they must have signed up once). This script never creates auth users.
--
-- IDEMPOTENCY
-- ---------------------------------------------------------------------------
-- Re-running raises each listed user to GREATEST(current_balance, 3).
-- It never stacks +3 on top of an existing balance of 3+.
-- Active Pro / Fleet windows are preserved (tier / tier_expires_at untouched).
-- =============================================================================

DO $$
DECLARE
  -- >>> EDIT THIS LIST <<<
  v_emails text[] := ARRAY[
    'tester1@example.com',
    'tester2@example.com'
  ];
  -- Target wallet floor (live RC lookups that burn one credit each).
  v_credits integer := 3;

  v_email text;
  v_norm text;
  v_user_id uuid;
  v_before integer;
  v_after integer;
  v_tier public.subscription_tier;
  v_found integer := 0;
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF v_credits < 1 THEN
    RAISE EXCEPTION 'v_credits must be >= 1';
  END IF;

  FOREACH v_email IN ARRAY v_emails
  LOOP
    v_norm := lower(btrim(v_email));
    IF v_norm = '' THEN
      CONTINUE;
    END IF;

    SELECT u.id
    INTO v_user_id
    FROM auth.users AS u
    WHERE lower(u.email) = v_norm
    LIMIT 1;

    IF v_user_id IS NULL THEN
      v_missing := array_append(v_missing, v_norm);
      RAISE NOTICE
        'BETA GRANT SKIPPED — email not in auth.users yet (invite first): %',
        v_norm;
      CONTINUE;
    END IF;

    -- Ensure wallet row exists (mirrors ensure_user_entitlement).
    INSERT INTO public.user_entitlements (
      user_id,
      tier,
      scan_credits_balance,
      max_vehicles
    )
    VALUES (
      v_user_id,
      'adhoc_audit'::public.subscription_tier,
      v_credits,
      5
    )
    ON CONFLICT (user_id) DO NOTHING;

    SELECT e.scan_credits_balance, e.tier
    INTO v_before, v_tier
    FROM public.user_entitlements AS e
    WHERE e.user_id = v_user_id
    FOR UPDATE;

    -- Preserve paid Pro / Fleet windows; otherwise mark as adhoc credit pack.
    UPDATE public.user_entitlements AS e
    SET
      scan_credits_balance = GREATEST(e.scan_credits_balance, v_credits),
      tier = CASE
        WHEN e.tier IN ('pro_annual', 'fleet_pass')
             AND e.tier_expires_at IS NOT NULL
             AND e.tier_expires_at > now()
          THEN e.tier
        ELSE 'adhoc_audit'::public.subscription_tier
      END,
      updated_at = now()
    WHERE e.user_id = v_user_id;

    SELECT e.scan_credits_balance
    INTO v_after
    FROM public.user_entitlements AS e
    WHERE e.user_id = v_user_id;

    v_found := v_found + 1;
    RAISE NOTICE
      'BETA GRANT OK — % (user_id=%) balance % → % (tier was %)',
      v_norm, v_user_id, v_before, v_after, v_tier;
  END LOOP;

  RAISE NOTICE
    'BETA GRANT SUMMARY — updated=% missing=%',
    v_found, coalesce(array_length(v_missing, 1), 0);

  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE NOTICE
      'Invite these emails in Auth → Users before re-running: %',
      array_to_string(v_missing, ', ');
  END IF;
END $$;

-- Optional verification (uncomment after editing the email list):
-- SELECT u.email, e.tier, e.scan_credits_balance, e.tier_expires_at, e.updated_at
-- FROM public.user_entitlements AS e
-- JOIN auth.users AS u ON u.id = e.user_id
-- WHERE lower(u.email) = ANY (ARRAY[
--   'tester1@example.com',
--   'tester2@example.com'
-- ]::text[])
-- ORDER BY u.email;
