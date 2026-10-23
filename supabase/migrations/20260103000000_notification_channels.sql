-- VahanKavach: multi-channel notification preferences (Telegram / WhatsApp / Signal).
-- Telegram is the functional default; WhatsApp remains supported; Signal is reserved.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

CREATE TYPE public.notification_channel AS ENUM (
  'TELEGRAM',
  'WHATSAPP',
  'SIGNAL'
);

COMMENT ON TYPE public.notification_channel IS
  'Outbound compliance alert channel. Default preference is TELEGRAM.';

-- ---------------------------------------------------------------------------
-- profiles: channel preference + Telegram / Signal link fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN preferred_channel public.notification_channel NOT NULL DEFAULT 'TELEGRAM',
  ADD COLUMN telegram_chat_id text,
  ADD COLUMN telegram_link_token text,
  ADD COLUMN signal_number text;

COMMENT ON COLUMN public.profiles.preferred_channel IS
  'User-selected alert channel. Dispatcher routes ComplianceAlertPayload here.';
COMMENT ON COLUMN public.profiles.telegram_chat_id IS
  'Telegram chat id after /start <token> linking. Unique when set.';
COMMENT ON COLUMN public.profiles.telegram_link_token IS
  'One-time deep-link token for t.me/<bot>?start=<token>. Cleared after link.';
COMMENT ON COLUMN public.profiles.signal_number IS
  'E.164 (or gateway handle) for Signal stub provider.';

-- Partial unique indexes: multiple NULLs allowed until the user links.
CREATE UNIQUE INDEX profiles_telegram_chat_id_uidx
  ON public.profiles (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE UNIQUE INDEX profiles_telegram_link_token_uidx
  ON public.profiles (telegram_link_token)
  WHERE telegram_link_token IS NOT NULL;
