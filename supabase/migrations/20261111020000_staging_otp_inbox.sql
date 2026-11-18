-- Staging-only OTP inbox so sandbox can complete phone auth when Fast2SMS
-- blocks Supabase Edge egress IPs (Dev API IP allowlist).

CREATE TABLE IF NOT EXISTS public.staging_otp_inbox (
  phone text PRIMARY KEY,
  otp text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staging_otp_inbox_otp_digits CHECK (otp ~ '^[0-9]{4,8}$')
);

COMMENT ON TABLE public.staging_otp_inbox IS
  'Ephemeral staging OTP mirror written by send-sms-hook. Never use in production clients.';

ALTER TABLE public.staging_otp_inbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staging_otp_inbox_service_role_all ON public.staging_otp_inbox;
CREATE POLICY staging_otp_inbox_service_role_all
  ON public.staging_otp_inbox
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.staging_otp_inbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.staging_otp_inbox TO service_role;
