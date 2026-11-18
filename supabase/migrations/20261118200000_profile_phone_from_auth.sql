-- Prefer auth.users.phone (OTP signup) when creating profiles.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, phone_number, full_name)
  VALUES (
    NEW.id,
    NULLIF(
      COALESCE(
        NEW.phone,
        NEW.raw_user_meta_data ->> 'phone_number',
        NEW.raw_user_meta_data ->> 'phone'
      ),
      ''
    ),
    NULLIF(
      COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name'
      ),
      ''
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Inserts public.profiles on auth.users insert. Prefers auth.users.phone, then raw_user_meta_data.';

-- Backfill existing profiles that never received phone from OTP signup.
UPDATE public.profiles AS p
SET
  phone_number = u.phone,
  updated_at = now()
FROM auth.users AS u
WHERE p.id = u.id
  AND (p.phone_number IS NULL OR btrim(p.phone_number) = '')
  AND u.phone IS NOT NULL
  AND btrim(u.phone) <> '';
