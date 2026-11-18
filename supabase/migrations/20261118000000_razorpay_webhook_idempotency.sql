-- Razorpay webhook idempotency + payment replay safety.
-- Prevents double-grant when both payment.captured and order.paid fire,
-- or when Razorpay retries the same delivery.

CREATE TABLE IF NOT EXISTS public.razorpay_webhook_events (
  event_id text PRIMARY KEY,
  event_type text,
  payment_id text,
  order_id text,
  outcome text NOT NULL DEFAULT 'processed',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.razorpay_webhook_events IS
  'Idempotency ledger for Razorpay webhook deliveries (x-razorpay-event-id).';

CREATE INDEX IF NOT EXISTS razorpay_webhook_events_payment_idx
  ON public.razorpay_webhook_events (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS razorpay_webhook_events_order_idx
  ON public.razorpay_webhook_events (order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE public.razorpay_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS razorpay_webhook_events_deny_all ON public.razorpay_webhook_events;
CREATE POLICY razorpay_webhook_events_deny_all
  ON public.razorpay_webhook_events
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- One Razorpay payment id may only settle one payments ledger row.
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_uidx
  ON public.payments (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- Claim a pending/failed payment for settlement (atomic).
CREATE OR REPLACE FUNCTION public.claim_payment_for_settlement(
  p_payment_id uuid,
  p_provider_payment_id text DEFAULT NULL,
  p_provider_signature text DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments;
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
  END IF;

  RETURN pay;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_payment_for_settlement(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_for_settlement(uuid, text, text) TO service_role;

-- Atomic order success claim (returns NULL if already SUCCESS).
CREATE OR REPLACE FUNCTION public.claim_order_paid(
  p_order_id uuid,
  p_razorpay_payment_id text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ord public.orders;
BEGIN
  UPDATE public.orders
  SET
    status = 'SUCCESS',
    razorpay_payment_id = COALESCE(p_razorpay_payment_id, razorpay_payment_id)
  WHERE id = p_order_id
    AND status IS DISTINCT FROM 'SUCCESS'
  RETURNING * INTO ord;

  RETURN ord; -- NULL when already settled
END;
$$;

REVOKE ALL ON FUNCTION public.claim_order_paid(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_paid(uuid, text) TO service_role;

-- Atomic payment_attempt claim.
CREATE OR REPLACE FUNCTION public.claim_payment_attempt_paid(
  p_attempt_id uuid,
  p_razorpay_payment_id text DEFAULT NULL
)
RETURNS public.payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  att public.payment_attempts;
BEGIN
  UPDATE public.payment_attempts
  SET
    status = 'paid',
    razorpay_payment_id = COALESCE(p_razorpay_payment_id, razorpay_payment_id)
  WHERE id = p_attempt_id
    AND status IS DISTINCT FROM 'paid'
  RETURNING * INTO att;

  RETURN att;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_payment_attempt_paid(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_attempt_paid(uuid, text) TO service_role;
