-- Module 4: CERT-In aligned audit logging (minimum 180-day retention).
-- Filename uses 20260108000000 because 20260105000000 is already billing_entitlements.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  ip_address text,
  user_agent text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_event_type_not_blank CHECK (length(btrim(event_type)) > 0)
);

COMMENT ON TABLE public.audit_logs IS
  'CERT-In aligned security/audit trail. Retained for at least 180 days before pruning is permitted.';
COMMENT ON COLUMN public.audit_logs.event_type IS
  'e.g. AUTH_LOGIN, VEHICLE_LOOKUP, CHALLAN_QUERY, PAYMENT_ATTEMPT';
COMMENT ON COLUMN public.audit_logs.request_payload IS
  'Redacted request metadata (never store full chassis, secrets, or card data).';

CREATE INDEX audit_logs_created_at_idx
  ON public.audit_logs USING btree (created_at);

CREATE INDEX audit_logs_user_created_idx
  ON public.audit_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX audit_logs_event_type_created_idx
  ON public.audit_logs (event_type, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- No end-user access; Edge Functions / admins use service_role.
CREATE POLICY audit_logs_service_role_all
  ON public.audit_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

-- ---------------------------------------------------------------------------
-- Retention: prune ONLY rows older than 180 days (never sooner).
-- CERT-In directions require logs be available for a minimum of 180 days.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prune_audit_logs_beyond_retention()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Hard floor: never delete anything younger than 180 days.
  DELETE FROM public.audit_logs
  WHERE created_at < (now() - interval '180 days');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.prune_audit_logs_beyond_retention() IS
  'CERT-In: deletes audit_logs strictly older than 180 days. Younger rows are never pruned.';

REVOKE ALL ON FUNCTION public.prune_audit_logs_beyond_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_audit_logs_beyond_retention() TO postgres, service_role;

DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  SELECT j.jobid
  INTO existing_jobid
  FROM cron.job AS j
  WHERE j.jobname = 'audit-logs-180d-retention'
  LIMIT 1;

  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;

  -- Daily 04:15 UTC — prune only rows past the 180-day floor.
  PERFORM cron.schedule(
    'audit-logs-180d-retention',
    '15 4 * * *',
    'SELECT public.prune_audit_logs_beyond_retention();'
  );
END;
$$;
