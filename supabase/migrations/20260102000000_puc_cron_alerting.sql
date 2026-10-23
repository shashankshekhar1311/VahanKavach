-- VahanKavach Module 4: proactive PUC alerting via pg_cron + pg_net.
--
-- Flow:
--   cron (08:30 IST / 03:00 UTC) → dispatch_daily_puc_alerts()
--     → net.http_post → Edge Function send-puc-alert
--       → WhatsApp Cloud API
--
-- Prerequisites (run once per environment AFTER this migration):
--   SELECT vault.create_secret(
--     'https://<project-ref>.supabase.co',  -- local Docker: http://kong:8000
--     'puc_alert_edge_base_url',
--     'Base URL used by pg_net to reach Edge Functions'
--   );
--   SELECT vault.create_secret(
--     '<SUPABASE_SERVICE_ROLE_KEY>',
--     'service_role_key',
--     'Bearer token for send-puc-alert Authorization header'
--   );
--
-- Manual test:
--   SELECT dispatch_daily_puc_alerts();
--   SELECT * FROM public.puc_alert_dispatches ORDER BY created_at DESC;
--   SELECT * FROM net._http_response ORDER BY created DESC LIMIT 20;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
-- Vault stores edge base URL + service_role key (never hardcode in SQL).
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA extensions TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- Deduplication log (same vehicle + alert type at most once per calendar day)
-- ---------------------------------------------------------------------------

CREATE TYPE public.puc_alert_type AS ENUM (
  'T7',
  'T1',
  'EXPIRED'
);

COMMENT ON TYPE public.puc_alert_type IS
  'PUC proactive alert windows: T7 = expiry in 7 days, T1 = tomorrow, EXPIRED = today.';

CREATE TABLE public.puc_alert_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  alert_type public.puc_alert_type NOT NULL,
  days_left integer NOT NULL,
  sent_on date NOT NULL DEFAULT (CURRENT_DATE),
  pg_net_request_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT puc_alert_dispatches_days_left_non_negative CHECK (days_left >= 0),
  CONSTRAINT puc_alert_dispatches_unique_daily
    UNIQUE (vehicle_id, alert_type, sent_on)
);

COMMENT ON TABLE public.puc_alert_dispatches IS
  'Idempotency log for Module 4 PUC WhatsApp alerts. Unique per vehicle/type/day.';

CREATE INDEX puc_alert_dispatches_sent_on_idx
  ON public.puc_alert_dispatches USING btree (sent_on);

CREATE INDEX puc_alert_dispatches_vehicle_id_idx
  ON public.puc_alert_dispatches USING btree (vehicle_id);

ALTER TABLE public.puc_alert_dispatches ENABLE ROW LEVEL SECURITY;

-- Owners can read their own dispatch history; only service_role / SECURITY DEFINER write.
CREATE POLICY puc_alert_dispatches_owner_select
  ON public.puc_alert_dispatches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vehicles AS v
      WHERE v.id = puc_alert_dispatches.vehicle_id
        AND v.user_id = auth.uid()
    )
  );

CREATE POLICY puc_alert_dispatches_service_role_all
  ON public.puc_alert_dispatches
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.puc_alert_dispatches FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.puc_alert_dispatches FROM authenticated;
GRANT SELECT ON TABLE public.puc_alert_dispatches TO authenticated;
GRANT ALL ON TABLE public.puc_alert_dispatches TO service_role;

-- ---------------------------------------------------------------------------
-- Vault helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._puc_alert_vault_secret(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT ds.decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets AS ds
  WHERE ds.name = p_name
  LIMIT 1;

  RETURN NULLIF(btrim(v_secret), '');
END;
$$;

COMMENT ON FUNCTION public._puc_alert_vault_secret(text) IS
  'Reads a decrypted vault secret by name. Used by dispatch_daily_puc_alerts.';

REVOKE ALL ON FUNCTION public._puc_alert_vault_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._puc_alert_vault_secret(text) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- Stored procedure: find due vehicles and POST to send-puc-alert
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dispatch_daily_puc_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  v_base_url := public._puc_alert_vault_secret('puc_alert_edge_base_url');
  v_service_key := public._puc_alert_vault_secret('service_role_key');

  IF v_base_url IS NULL OR v_service_key IS NULL THEN
    RAISE EXCEPTION
      'Missing vault secrets. Create puc_alert_edge_base_url and service_role_key via vault.create_secret(...)';
  END IF;

  -- Trim trailing slash so we can append /functions/v1/...
  v_base_url := regexp_replace(v_base_url, '/+$', '');
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
        CASE
          WHEN v.puc_expiry_date = (CURRENT_DATE + 7) THEN 'T7'::public.puc_alert_type
          WHEN v.puc_expiry_date = (CURRENT_DATE + 1) THEN 'T1'::public.puc_alert_type
          WHEN v.puc_expiry_date = CURRENT_DATE THEN 'EXPIRED'::public.puc_alert_type
        END AS alert_type,
        CASE
          WHEN v.puc_expiry_date = (CURRENT_DATE + 7) THEN 7
          WHEN v.puc_expiry_date = (CURRENT_DATE + 1) THEN 1
          WHEN v.puc_expiry_date = CURRENT_DATE THEN 0
        END AS days_left
      FROM public.vehicles AS v
      INNER JOIN public.profiles AS p
        ON p.id = v.user_id
      WHERE v.puc_expiry_date IS NOT NULL
        AND p.phone_number IS NOT NULL
        AND (
          v.puc_expiry_date = (CURRENT_DATE + 7)
          OR v.puc_expiry_date = (CURRENT_DATE + 1)
          OR v.puc_expiry_date = CURRENT_DATE
        )
    )
    SELECT d.vehicle_id, d.alert_type, d.days_left
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
      -- Claim the daily slot first so a retry cannot double-send.
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
          'daysLeft', v_rec.days_left
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
        -- Another concurrent run already claimed this alert today.
        v_skipped := v_skipped + 1;
      WHEN OTHERS THEN
        v_errors := array_append(
          v_errors,
          format('%s/%s: %s', v_rec.vehicle_id, v_rec.alert_type, SQLERRM)
        );
        -- Roll back the claim so a later run can retry this vehicle.
        DELETE FROM public.puc_alert_dispatches
        WHERE vehicle_id = v_rec.vehicle_id
          AND alert_type = v_rec.alert_type
          AND sent_on = CURRENT_DATE
          AND pg_net_request_id IS NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'dispatched', v_dispatched,
    'skipped_duplicates', v_skipped,
    'errors', to_jsonb(v_errors),
    'ran_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.dispatch_daily_puc_alerts() IS
  'Module 4: enqueue WhatsApp PUC alerts (T-7 / T-1 / expired-today) via pg_net → send-puc-alert.';

REVOKE ALL ON FUNCTION public.dispatch_daily_puc_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_daily_puc_alerts() TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- Cron: every day 08:30 IST = 03:00 UTC
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  SELECT j.jobid
  INTO existing_jobid
  FROM cron.job AS j
  WHERE j.jobname = 'daily-puc-audit'
  LIMIT 1;

  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'daily-puc-audit',
    '0 3 * * *',
    'SELECT public.dispatch_daily_puc_alerts();'
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
