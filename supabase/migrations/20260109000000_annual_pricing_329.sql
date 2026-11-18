-- Align orders default amount with Kavach Pro annual prepaid (₹329/vehicle/year).

ALTER TABLE public.orders
  ALTER COLUMN amount SET DEFAULT 329.00;

COMMENT ON COLUMN public.orders.amount IS
  'Order total in INR rupees. Kavach Pro = ₹329 × vehicle_qty (annual prepaid).';
