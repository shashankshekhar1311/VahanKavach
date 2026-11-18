-- Store Telegram @username when linking via /start <token>.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telegram_username text;

COMMENT ON COLUMN public.profiles.telegram_username IS
  'Telegram @username captured at link time (no leading @). Cleared on unlink.';
