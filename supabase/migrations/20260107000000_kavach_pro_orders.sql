-- Module 3: Kavach Pro annual pass (₹249/year) — Razorpay orders ledger.
-- Filename uses 20260107000000 because 20260104000000 is already vehicle_claim_gate.

CREATE TYPE public.payment_status AS ENUM (
  'PENDING',
  'SUCCESS',
  'FAILED'
);

COMMENT ON TYPE public.payment_status IS
  'Razorpay order lifecycle for Kavach Pro annual checkout.';

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  razorpay_order_id text UNIQUE,
  amount numeric(10, 2) NOT NULL DEFAULT 249.00,
  currency text NOT NULL DEFAULT 'INR',
  status public.payment_status NOT NULL DEFAULT 'PENDING',
  razorpay_payment_id text,
  razorpay_signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_amount_positive CHECK (amount > 0),
  CONSTRAINT orders_currency_not_blank CHECK (length(btrim(currency)) > 0)
);

COMMENT ON TABLE public.orders IS
  'Kavach Pro annual pass checkout orders (₹249 INR). Distinct from per-vehicle payment_attempts.';
COMMENT ON COLUMN public.orders.amount IS
  'Order amount in major currency units (INR rupees), default 249.00.';
COMMENT ON COLUMN public.orders.razorpay_signature IS
  'Checkout handler HMAC (order_id|payment_id) when client verifies payment.';

CREATE INDEX orders_user_created_idx
  ON public.orders (user_id, created_at DESC);

CREATE INDEX orders_status_idx
  ON public.orders (status);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Users can read only their own orders.
CREATE POLICY orders_owner_select
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- service_role full access (create-order, webhook, verify-order).
CREATE POLICY orders_service_role_all
  ON public.orders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.orders FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;
