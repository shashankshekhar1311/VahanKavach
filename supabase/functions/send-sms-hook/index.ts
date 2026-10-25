/**
 * send-sms-hook — Supabase Auth "Send SMS" HTTP Hook
 *
 * Called by GoTrue when a phone OTP is issued. Sends the OTP via Fast2SMS.
 *
 * Payload (after Standard Webhooks verify):
 *   { user: { phone: "+91..." }, sms: { otp: "123456" } }
 *
 * Secrets:
 *   FAST2SMS_API_KEY          — Fast2SMS authorization header
 *   SEND_SMS_HOOK_SECRET      — optional; v1,whsec_<base64> from Auth Hooks UI
 *
 * Deploy: supabase functions deploy send-sms-hook --no-verify-jwt
 */

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = Deno.env.get('FAST2SMS_API_KEY')?.trim();
  if (!apiKey) {
    console.error('FAST2SMS_API_KEY missing');
    return jsonError(500, 'FAST2SMS_API_KEY missing');
  }

  const rawBody = await req.text();

  let user: { phone?: string } | undefined;
  let sms: { otp?: string } | undefined;

  const hookSecretRaw = Deno.env.get('SEND_SMS_HOOK_SECRET')?.trim();
  if (hookSecretRaw) {
    try {
      // Dashboard secret looks like: v1,whsec_<base64>
      const base64Secret = hookSecretRaw.replace(/^v1,whsec_/, '');
      const wh = new Webhook(base64Secret);
      const headers = Object.fromEntries(req.headers);
      const verified = wh.verify(rawBody, headers) as {
        user?: { phone?: string };
        sms?: { otp?: string };
      };
      user = verified.user;
      sms = verified.sms;
    } catch (err) {
      console.error('Send SMS hook signature verify failed', err);
      return jsonError(401, 'Invalid hook signature');
    }
  } else {
    // No hook secret configured — accept JSON body (dev / first-time setup).
    try {
      const parsed = JSON.parse(rawBody) as {
        user?: { phone?: string };
        sms?: { otp?: string };
      };
      user = parsed.user;
      sms = parsed.sms;
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }
  }

  const otp = sms?.otp?.trim();
  // Official Send SMS Hook schema: phone is on user, OTP is on sms.
  let phone = user?.phone?.trim() ?? '';

  if (!phone || !otp) {
    console.error('Missing phone or OTP', { hasPhone: Boolean(phone), hasOtp: Boolean(otp) });
    return jsonError(400, 'Missing phone or OTP');
  }

  // Fast2SMS OTP route expects 10-digit Indian mobiles (no +91).
  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('91') && phone.length === 12) {
    phone = phone.slice(2);
  }
  if (phone.length !== 10) {
    console.error('Unsupported phone for Fast2SMS OTP route', { phoneLen: phone.length });
    return jsonError(400, 'Phone must be a 10-digit Indian mobile');
  }

  const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      route: 'otp',
      variables_values: otp,
      numbers: phone,
    }),
  });

  const result = (await response.json().catch(() => null)) as {
    return?: boolean;
    message?: string[] | string;
  } | null;

  if (!response.ok || !result?.return) {
    console.error('[Fast2SMS Error]', response.status, result);
    const msg = Array.isArray(result?.message)
      ? result?.message[0]
      : typeof result?.message === 'string'
      ? result.message
      : 'SMS sending failed';
    return jsonError(500, msg || 'SMS sending failed');
  }

  // Empty 200 tells GoTrue the OTP was delivered.
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
