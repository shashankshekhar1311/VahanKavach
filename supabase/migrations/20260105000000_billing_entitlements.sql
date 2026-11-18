-- M1/M3/M5: ₹1/day/vehicle (~₹30/vehicle/month) entitlements + payments audit.
-- Trial first vehicle; subscription covers N vehicles; alerts require active entitlement.

-- ---------------------------------------------------------------------------
-- Subscriptions (owner-level)
-- ---------------------------------------------------------------------------
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'trial',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  vehicle_qty integer NOT NULL DEFAULT 0,
  amount_paise_per_vehicle integer NOT NULL DEFAULT 3000,
  razorpay_customer_id text,
  razorpay_subscription_id text,
  razorpay_last_order_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_status_check CHECK (
    status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')
  ),
  CONSTRAINT subscriptions_vehicle_qty_non_negative CHECK (vehicle_qty >= 0),
  CONSTRAINT subscriptions_amount_positive CHECK (amount_paise_per_vehicle > 0)
);

COMMENT ON TABLE public.subscriptions IS
  'Owner billing state. vehicle_qty = how many vehicles the current period covers.';
COMMENT ON COLUMN public.subscriptions.amount_paise_per_vehicle IS
  'Default 3000 paise = ₹30/vehicle/month (~₹1/day).';

CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Per-vehicle entitlements (alert + refresh gate)
-- ---------------------------------------------------------------------------
CREATE TABLE public.vehicle_entitlements (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  active_until timestamptz NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_entitlements_source_check CHECK (
    source IN ('trial', 'subscription', 'admin_grant')
  )
);

COMMENT ON TABLE public.vehicle_entitlements IS
  'Vehicle is billable/alertable while active_until > now().';

CREATE INDEX vehicle_entitlements_user_idx
  ON public.vehicle_entitlements (user_id);

CREATE INDEX vehicle_entitlements_active_until_idx
  ON public.vehicle_entitlements (active_until);

CREATE TRIGGER vehicle_entitlements_set_updated_at
  BEFORE UPDATE ON public.vehicle_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Payment attempts (subscription checkout + challan redirect audit)
-- ---------------------------------------------------------------------------
CREATE TABLE public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles (id) ON DELETE SET NULL,
  challan_id uuid REFERENCES public.challans (id) ON DELETE SET NULL,
  kind text NOT NULL,
  amount_paise integer,
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created',
  vehicle_qty integer,
  razorpay_order_id text,
  razorpay_payment_id text,
  portal_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_attempts_kind_check CHECK (
    kind IN ('subscription', 'challan')
  ),
  CONSTRAINT payment_attempts_status_check CHECK (
    status IN (
      'created',
      'pending',
      'paid',
      'failed',
      'cancelled',
      'redirected'
    )
  )
);

CREATE INDEX payment_attempts_user_created_idx
  ON public.payment_attempts (user_id, created_at DESC);

CREATE INDEX payment_attempts_razorpay_order_idx
  ON public.payment_attempts (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE TRIGGER payment_attempts_set_updated_at
  BEFORE UPDATE ON public.payment_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_owner_select
  ON public.subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY vehicle_entitlements_owner_select
  ON public.vehicle_entitlements FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY payment_attempts_owner_select
  ON public.payment_attempts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY payment_attempts_owner_insert
  ON public.payment_attempts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY payment_attempts_owner_update
  ON public.payment_attempts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY subscriptions_service_role_all
  ON public.subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY vehicle_entitlements_service_role_all
  ON public.vehicle_entitlements FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY payment_attempts_service_role_all
  ON public.payment_attempts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.vehicle_entitlements FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.payment_attempts FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT SELECT ON TABLE public.vehicle_entitlements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_attempts TO authenticated;

GRANT ALL ON TABLE public.subscriptions TO service_role;
GRANT ALL ON TABLE public.vehicle_entitlements TO service_role;
GRANT ALL ON TABLE public.payment_attempts TO service_role;

-- ---------------------------------------------------------------------------
-- Helper: is vehicle entitled right now?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_vehicle_entitled(p_vehicle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vehicle_entitlements AS e
    WHERE e.vehicle_id = p_vehicle_id
      AND e.active_until > now()
  );
$$;

REVOKE ALL ON FUNCTION public.is_vehicle_entitled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_vehicle_entitled(uuid) TO authenticated, service_role;

-- Admin/ops: grant trial or paid window to all of a user's vehicles
CREATE OR REPLACE FUNCTION public.admin_grant_user_entitlements(
  p_user_id uuid,
  p_days integer DEFAULT 30,
  p_source text DEFAULT 'admin_grant'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_until timestamptz := now() + make_interval(days => GREATEST(p_days, 1));
  v_count integer := 0;
BEGIN
  IF p_source NOT IN ('trial', 'subscription', 'admin_grant') THEN
    RAISE EXCEPTION 'invalid source';
  END IF;

  INSERT INTO public.subscriptions AS s (
    user_id,
    status,
    trial_ends_at,
    current_period_start,
    current_period_end,
    vehicle_qty
  )
  SELECT
    p_user_id,
    CASE WHEN p_source = 'trial' THEN 'trial' ELSE 'active' END,
    CASE WHEN p_source = 'trial' THEN v_until ELSE NULL END,
    now(),
    v_until,
    (SELECT count(*)::integer FROM public.vehicles WHERE user_id = p_user_id)
  ON CONFLICT (user_id) DO UPDATE
  SET
    status = EXCLUDED.status,
    current_period_start = now(),
    current_period_end = v_until,
    trial_ends_at = CASE
      WHEN p_source = 'trial' THEN v_until
      ELSE s.trial_ends_at
    END,
    vehicle_qty = EXCLUDED.vehicle_qty,
    updated_at = now();

  INSERT INTO public.vehicle_entitlements AS e (
    vehicle_id,
    user_id,
    active_until,
    source
  )
  SELECT v.id, v.user_id, v_until, p_source
  FROM public.vehicles AS v
  WHERE v.user_id = p_user_id
  ON CONFLICT (vehicle_id) DO UPDATE
  SET
    active_until = GREATEST(e.active_until, EXCLUDED.active_until),
    source = EXCLUDED.source,
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_user_entitlements(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_user_entitlements(uuid, integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Alert types for insurance (PUC enum extension)
-- ---------------------------------------------------------------------------
ALTER TYPE public.puc_alert_type ADD VALUE IF NOT EXISTS 'INS_T7';
ALTER TYPE public.puc_alert_type ADD VALUE IF NOT EXISTS 'INS_T1';
ALTER TYPE public.puc_alert_type ADD VALUE IF NOT EXISTS 'INS_EXPIRED';

-- ---------------------------------------------------------------------------
-- Cron: entitle + telegram/phone, PUC + insurance windows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_daily_puc_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net, vault
AS $$
DECLARE
  v_base_url text;
  v_service_key text;
  v_endpoint text;
  v_headers jsonb;
  v_rec record;
  v_request_id bigint;
  v_dispatched integer := 0;
  v_skipped integer := 0;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  SELECT decrypted_secret INTO v_base_url
  FROM vault.decrypted_secrets
  WHERE name = 'puc_alert_edge_base_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_base_url IS NULL OR btrim(v_base_url) = '' THEN
    RAISE EXCEPTION 'vault secret puc_alert_edge_base_url is not set';
  END IF;
  IF v_service_key IS NULL OR btrim(v_service_key) = '' THEN
    RAISE EXCEPTION 'vault secret service_role_key is not set';
  END IF;

  v_base_url := rtrim(v_base_url, '/');
  v_endpoint := v_base_url || '/functions/v1/send-puc-alert';

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_service_key,
    'apikey', v_service_key
  );

  FOR v_rec IN
    WITH due AS (
      SELECT
        v.id AS vehicle_id,
        x.alert_type,
        x.days_left,
        x.alert_kind
      FROM public.vehicles AS v
      INNER JOIN public.profiles AS p ON p.id = v.user_id
      INNER JOIN public.vehicle_entitlements AS e
        ON e.vehicle_id = v.id
       AND e.active_until > now()
      CROSS JOIN LATERAL (
        VALUES
          (
            CASE
              WHEN v.puc_expiry_date = (CURRENT_DATE + 7) THEN 'T7'::public.puc_alert_type
              WHEN v.puc_expiry_date = (CURRENT_DATE + 1) THEN 'T1'::public.puc_alert_type
              WHEN v.puc_expiry_date = CURRENT_DATE THEN 'EXPIRED'::public.puc_alert_type
            END,
            CASE
              WHEN v.puc_expiry_date = (CURRENT_DATE + 7) THEN 7
              WHEN v.puc_expiry_date = (CURRENT_DATE + 1) THEN 1
              WHEN v.puc_expiry_date = CURRENT_DATE THEN 0
            END,
            'PUC'
          ),
          (
            CASE
              WHEN v.insurance_expiry_date = (CURRENT_DATE + 7) THEN 'INS_T7'::public.puc_alert_type
              WHEN v.insurance_expiry_date = (CURRENT_DATE + 1) THEN 'INS_T1'::public.puc_alert_type
              WHEN v.insurance_expiry_date = CURRENT_DATE THEN 'INS_EXPIRED'::public.puc_alert_type
            END,
            CASE
              WHEN v.insurance_expiry_date = (CURRENT_DATE + 7) THEN 7
              WHEN v.insurance_expiry_date = (CURRENT_DATE + 1) THEN 1
              WHEN v.insurance_expiry_date = CURRENT_DATE THEN 0
            END,
            'INSURANCE'
          )
      ) AS x(alert_type, days_left, alert_kind)
      WHERE (
          p.telegram_chat_id IS NOT NULL
          OR p.phone_number IS NOT NULL
        )
        AND x.alert_type IS NOT NULL
    )
    SELECT d.vehicle_id, d.alert_type, d.days_left, d.alert_kind
    FROM due AS d
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.puc_alert_dispatches AS pad
      WHERE pad.vehicle_id = d.vehicle_id
        AND pad.alert_type = d.alert_type
        AND pad.sent_on = CURRENT_DATE
    )
  LOOP
    BEGIN
      INSERT INTO public.puc_alert_dispatches (
        vehicle_id,
        alert_type,
        days_left,
        sent_on
      ) VALUES (
        v_rec.vehicle_id,
        v_rec.alert_type,
        v_rec.days_left,
        CURRENT_DATE
      );

      v_request_id := net.http_post(
        url := v_endpoint,
        headers := v_headers,
        body := jsonb_build_object(
          'vehicleId', v_rec.vehicle_id,
          'daysLeft', v_rec.days_left,
          'alertKind', v_rec.alert_kind
        ),
        timeout_milliseconds := 10000
      );

      UPDATE public.puc_alert_dispatches
      SET pg_net_request_id = v_request_id
      WHERE vehicle_id = v_rec.vehicle_id
        AND alert_type = v_rec.alert_type
        AND sent_on = CURRENT_DATE;

      v_dispatched := v_dispatched + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_skipped := v_skipped + 1;
      WHEN OTHERS THEN
        v_errors := array_append(
          v_errors,
          format('%s/%s: %s', v_rec.vehicle_id, v_rec.alert_type, SQLERRM)
        );
        DELETE FROM public.puc_alert_dispatches
        WHERE vehicle_id = v_rec.vehicle_id
          AND alert_type = v_rec.alert_type
          AND sent_on = CURRENT_DATE
          AND pg_net_request_id IS NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'errors', to_jsonb(v_errors)
  );
END;
$$;
