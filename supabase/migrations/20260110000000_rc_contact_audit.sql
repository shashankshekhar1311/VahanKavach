-- RC Contact & Aadhaar Seeding Audit
-- Detects vehicles whose RC is not seeded with an active mobile / Aadhaar,
-- enabling amber dashboard warnings and one-shot Telegram alerts.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS rc_mobile_linked BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rc_aadhaar_linked BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rc_contact_warning BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_audit_notified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vehicles.rc_mobile_linked IS
  'True when VAHAN RC record has a non-dummy seeded mobile number.';
COMMENT ON COLUMN public.vehicles.rc_aadhaar_linked IS
  'True when VAHAN RC record indicates Aadhaar seeding.';
COMMENT ON COLUMN public.vehicles.rc_contact_warning IS
  'Derived: true when mobile OR Aadhaar is not seeded (₹1,000 fine risk).';
COMMENT ON COLUMN public.vehicles.contact_audit_notified IS
  'True after a one-shot RC_CONTACT_WARNING Telegram alert was dispatched.';

CREATE INDEX IF NOT EXISTS vehicles_rc_contact_warning_idx
  ON public.vehicles (user_id)
  WHERE rc_contact_warning = true;
