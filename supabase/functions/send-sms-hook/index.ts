/**
 * send-sms-hook — Supabase Auth "Send SMS" HTTP Hook (Fast2SMS)
 *
 * Auth waits ≤5s — keep under ~4s. Staging mirrors OTP to staging_otp_inbox
 * when Fast2SMS blocks Edge egress IPs.
 *
 * Deploy: supabase functions deploy send-sms-hook --no-verify-jwt --yes
 */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const started = Date.now();
  const isStaging =
    (Deno.env.get('ENVIRONMENT') ?? '').toLowerCase() === 'staging';

  try {
    const rawBody = await req.text();
    const payload = await extractPayload(rawBody, req.headers, isStaging);
    if (!payload.ok) {
      console.error('payload extract failed', payload.reason, {
        ms: Date.now() - started,
      });
      return authHookError(payload.reason);
    }

    const otp = payload.sms?.otp?.trim();
    let phoneE164 = payload.user?.phone?.trim() ?? '';
    if (!phoneE164 || !otp) {
      return authHookError('Missing phone or OTP in Send SMS hook payload.');
    }

    let phone10 = phoneE164.replace(/\D/g, '');
    if (phone10.startsWith('91') && phone10.length === 12) {
      phone10 = phone10.slice(2);
    }
    if (phone10.length !== 10) {
      return authHookError('Phone must be a 10-digit Indian mobile.');
    }

    // Always mirror on staging so the web app can peek the OTP if SMS fails.
    if (isStaging) {
      await mirrorStagingOtp(phone10, otp);
    }

    const apiKey = Deno.env.get('FAST2SMS_API_KEY')?.trim();
    if (!apiKey) {
      if (isStaging) {
        console.warn('FAST2SMS_API_KEY missing — staging OTP mirrored only');
        return okEmpty();
      }
      return authHookError('SMS provider is not configured (FAST2SMS_API_KEY).');
    }

    try {
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          route: 'otp',
          variables_values: otp,
          numbers: phone10,
        }),
        signal: AbortSignal.timeout(3500),
      });

      const result = (await response.json().catch(() => null)) as {
        return?: boolean;
        message?: string[] | string;
        status_code?: number | string;
      } | null;

      if (!response.ok || !result?.return) {
        const msg = Array.isArray(result?.message)
          ? result.message[0]
          : typeof result?.message === 'string'
          ? result.message
          : 'SMS sending failed';
        console.error('[Fast2SMS Error]', response.status, result, {
          ms: Date.now() - started,
        });

        // Staging: Auth challenge still succeeds; client peeks mirrored OTP.
        if (isStaging) {
          console.warn('staging SMS delivery failed — OTP mirrored for peek', msg);
          return okEmpty();
        }
        return authHookError(msg || 'SMS sending failed');
      }

      console.log('send-sms-hook ok', { ms: Date.now() - started, staging: isStaging });
      return okEmpty();
    } catch (err) {
      console.error('Fast2SMS request failed', err, { ms: Date.now() - started });
      if (isStaging) {
        console.warn('staging Fast2SMS timeout/error — OTP mirrored for peek');
        return okEmpty();
      }
      return authHookError('Could not send SMS code. Try again in a minute.');
    }
  } catch (err) {
    console.error('send-sms-hook fatal', err, { ms: Date.now() - started });
    return authHookError('Could not send SMS code. Try again in a minute.');
  }
});

type SmsPayload = {
  user?: { phone?: string };
  sms?: { otp?: string };
};

async function extractPayload(
  rawBody: string,
  headers: Headers,
  isStaging: boolean,
): Promise<{ ok: true } & SmsPayload | { ok: false; reason: string }> {
  const relaxed =
    isStaging ||
    (Deno.env.get('SEND_SMS_HOOK_RELAXED') ?? '').toLowerCase() === 'true';
  const hookSecretRaw = Deno.env.get('SEND_SMS_HOOK_SECRET')?.trim();

  if (!hookSecretRaw || relaxed) {
    try {
      const parsed = JSON.parse(rawBody) as SmsPayload;
      return { ok: true, user: parsed.user, sms: parsed.sms };
    } catch {
      return { ok: false, reason: 'Invalid JSON body' };
    }
  }

  try {
    const { Webhook } = await import('https://esm.sh/standardwebhooks@1.0.0');
    const base64Secret = hookSecretRaw.includes('whsec_')
      ? hookSecretRaw.replace(/^v1,whsec_/, '').replace(/^whsec_/, '')
      : hookSecretRaw;
    if (!/^[A-Za-z0-9+/=_-]+$/.test(base64Secret) || base64Secret.length < 16) {
      return {
        ok: false,
        reason:
          'SEND_SMS_HOOK_SECRET is invalid. Paste full v1,whsec_… from Auth → Hooks.',
      };
    }
    const verified = new Webhook(base64Secret).verify(
      rawBody,
      Object.fromEntries(headers),
    ) as SmsPayload;
    return { ok: true, user: verified.user, sms: verified.sms };
  } catch (err) {
    console.error('signature verify failed', err);
    return {
      ok: false,
      reason:
        'Invalid Send SMS hook signature. Re-copy SEND_SMS_HOOK_SECRET from Auth → Hooks.',
    };
  }
}

async function mirrorStagingOtp(phone10: string, otp: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.warn('staging OTP mirror skipped — missing service role env');
    return;
  }
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/staging_otp_inbox`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        phone: phone10,
        otp,
        created_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      console.warn('staging OTP mirror failed', res.status, await res.text());
    }
  } catch (err) {
    console.warn('staging OTP mirror error', err);
  }
}

function okEmpty(): Response {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authHookError(message: string): Response {
  return new Response(
    JSON.stringify({ error: { http_code: 500, message } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
