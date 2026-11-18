/** Shared CORS + security headers for VahanKavach Edge Functions. */

import { SECURITY_HEADERS } from './security.ts';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  ...SECURITY_HEADERS,
};

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

export function optionsResponse(): Response {
  return new Response('ok', { headers: corsHeaders });
}

/** 429 helper with Retry-After for rate limits. */
export function rateLimitedResponse(
  error: string,
  retryAfterSec: number,
): Response {
  return jsonResponse(
    { success: false, error },
    429,
    { 'Retry-After': String(Math.max(1, retryAfterSec)) },
  );
}
