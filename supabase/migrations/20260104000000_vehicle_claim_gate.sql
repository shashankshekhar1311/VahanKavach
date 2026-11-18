-- Ownership claim audit for sync-vehicle claim/verify gate.
-- First-time Protect requires chassis last-5 proof; refresh only for owned vehicles.

CREATE TABLE public.vehicle_claim_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reg_number text NOT NULL,
  chassis_last_5_submitted text NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_claim_attempts_outcome_check CHECK (
    outcome IN ('verified', 'rejected', 'conflict')
  ),
  CONSTRAINT vehicle_claim_attempts_reg_format CHECK (
    reg_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
  ),
  CONSTRAINT vehicle_claim_attempts_chassis_format CHECK (
    chassis_last_5_submitted ~ '^[A-Z0-9]{5}$'
  )
);

COMMENT ON TABLE public.vehicle_claim_attempts IS
  'Audit log of Protect/claim attempts. Verified claims then upsert into vehicles.';

CREATE INDEX vehicle_claim_attempts_user_created_idx
  ON public.vehicle_claim_attempts (user_id, created_at DESC);

CREATE INDEX vehicle_claim_attempts_reg_created_idx
  ON public.vehicle_claim_attempts (reg_number, created_at DESC);

ALTER TABLE public.vehicle_claim_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY vehicle_claim_attempts_owner_select
  ON public.vehicle_claim_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY vehicle_claim_attempts_owner_insert
  ON public.vehicle_claim_attempts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY vehicle_claim_attempts_service_role_all
  ON public.vehicle_claim_attempts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.vehicle_claim_attempts FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.vehicle_claim_attempts TO authenticated;
GRANT ALL ON TABLE public.vehicle_claim_attempts TO service_role;
