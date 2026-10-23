/** Shared Razorpay HMAC helpers (webhook body + checkout payment signature). */

export async function hmacSha256Hex(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/** Webhook: HMAC-SHA256(raw_body, webhook_secret) vs X-Razorpay-Signature. */
export async function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const hex = await hmacSha256Hex(secret, body);
  return timingSafeEqual(hex, signature);
}

/**
 * Checkout handler: HMAC-SHA256(`${orderId}|${paymentId}`, key_secret)
 * vs razorpay_signature.
 */
export async function verifyCheckoutPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): Promise<boolean> {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  const hex = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`);
  return timingSafeEqual(hex, signature);
}
