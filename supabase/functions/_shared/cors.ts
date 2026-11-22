/** Shared CORS + security headers for VahanKavach Edge Functions. */

import { SECURITY_HEADERS } from './security.ts';

const DEFAULT_PROD_ORIGINS = [
  'https://vahankavach.sunrisesoftwares.com',
  'https://vahankavach.pages.dev',
];

function allowedOrigins(): string[] {
  const fromEnv = (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const envName = (Deno.env.get('ENVIRONMENT') ?? '').toLowerCase();
  const isProd = envName === 'production' || envName === 'prod';
  const origins = fromEnv.length > 0 ? fromEnv : [...DEFAULT_PROD_ORIGINS];
  if (!isProd) {
    origins.push(
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
    );
  }
  return origins;
}

export function corsOriginForRequest(req?: Request | null): string {
  const origin = req?.headers.get('Origin')?.trim() ?? '';
  const allowed = allowedOrigins();
  if (origin && allowed.includes(origin)) return origin;
  // Non-browser callers (webhooks, curl) — echo first allowlist entry, never *.
  return allowed[0] ?? DEFAULT_PROD_ORIGINS[0];
}

export function corsHeadersFor(req?: Request | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': corsOriginForRequest(req),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token, x-hub-signature-256, webhook-id, webhook-timestamp, webhook-signature',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    Vary: 'Origin',
    ...SECURITY_HEADERS,
  };
}

/** @deprecated Prefer corsHeadersFor(req) — kept for call sites without Request. */
export const corsHeaders: Record<string, string> = corsHeadersFor();

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  req?: Request | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersFor(req),
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

export function optionsResponse(req?: Request | null): Response {
  return new Response('ok', { headers: corsHeadersFor(req) });
}

/** 429 helper with Retry-After for rate limits. */
export function rateLimitedResponse(
  error: string,
  retryAfterSec: number,
  req?: Request | null,
): Response {
  return jsonResponse(
    { success: false, error },
    429,
    { 'Retry-After': String(Math.max(1, retryAfterSec)) },
    req,
  );
}
