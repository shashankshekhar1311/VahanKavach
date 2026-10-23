/**
 * Module 4 — Edge Function security: rate limiting, plate sanitization, headers.
 *
 * Rate limiter is an in-memory sliding window (per Deno isolate). Suitable for
 * scraper throttling; for multi-isolate hard caps, pair with DB/Redis later.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Strict Indian registration after strip/uppercase (project rule). */
export const INDIAN_REG_STRICT_PATTERN =
  /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection': '0',
};

export type AuditEventType =
  | 'AUTH_LOGIN'
  | 'VEHICLE_LOOKUP'
  | 'CHALLAN_QUERY'
  | 'PAYMENT_ATTEMPT'
  | 'ACCOUNT_DELETE'
  | 'RATE_LIMITED';

export class SecurityValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'SecurityValidationError';
  }
}

export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number, message?: string) {
    super(
      message ??
        `Rate limit exceeded. Retry after ${retryAfterSec} second(s).`,
    );
    this.name = 'RateLimitError';
    this.retryAfterSec = retryAfterSec;
  }
}

// ---------------------------------------------------------------------------
// Sliding-window rate limiter (in-memory)
// ---------------------------------------------------------------------------

const hitBuckets = new Map<string, number[]>();

const DEFAULT_VEHICLE_LOOKUP_LIMIT = 5;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
};

/**
 * Sliding-window check. Key should include scope + IP (and optionally user id).
 * Default: 5 vehicle lookups / IP / hour.
 */
export function checkSlidingWindowRateLimit(
  key: string,
  limit = DEFAULT_VEHICLE_LOOKUP_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs;
  const prev = hitBuckets.get(key) ?? [];
  const recent = prev.filter((t) => t > cutoff);

  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldest + windowMs - now) / 1000),
    );
    hitBuckets.set(key, recent);
    return { allowed: false, remaining: 0, retryAfterSec, limit };
  }

  recent.push(now);
  hitBuckets.set(key, recent);
  // Opportunistic cleanup to bound memory.
  if (hitBuckets.size > 10_000) {
    for (const [k, times] of hitBuckets) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length === 0) hitBuckets.delete(k);
      else hitBuckets.set(k, kept);
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - recent.length),
    retryAfterSec: 0,
    limit,
  };
}

/** Assert vehicle-lookup budget for an IP (throws RateLimitError). */
export function assertVehicleLookupRateLimit(ip: string): RateLimitResult {
  const key = `vehicle_lookup:${ip || 'unknown'}`;
  const result = checkSlidingWindowRateLimit(key);
  if (!result.allowed) {
    throw new RateLimitError(
      result.retryAfterSec,
      'Too many vehicle lookups from this network. Maximum 5 per hour.',
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Registration sanitization
// ---------------------------------------------------------------------------

/**
 * Strip separators, uppercase, then require strict Indian plate regex.
 * Rejects any input that does not produce a match for
 * ^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$
 */
export function assertStrictIndianVehicleNumber(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new SecurityValidationError(
      'Vehicle registration is required and must match Indian plate format.',
    );
  }

  const sanitized = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  if (!INDIAN_REG_STRICT_PATTERN.test(sanitized)) {
    throw new SecurityValidationError(
      `Invalid Indian vehicle registration: rejected "${String(raw)}". ` +
        'Expected pattern ^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$ (e.g. KA01AB1234).',
    );
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// Request metadata helpers
// ---------------------------------------------------------------------------

export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 128);
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf.slice(0, 128);
  return 'unknown';
}

export function userAgentFromRequest(req: Request): string | null {
  const ua = req.headers.get('user-agent');
  if (!ua) return null;
  return ua.slice(0, 512);
}

/** Redact sensitive keys before persisting audit payloads. */
export function redactAuditPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const blocked = new Set([
    'chassislast5',
    'chassis_last_5',
    'password',
    'token',
    'authorization',
    'secret',
    'signature',
    'razorpay_signature',
    'keysecret',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (blocked.has(k.toLowerCase().replace(/[^a-z0-9_]/g, ''))) {
      out[k] = '[REDACTED]';
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactAuditPayload(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function writeAuditLog(
  admin: SupabaseClient,
  input: {
    userId?: string | null;
    eventType: AuditEventType | string;
    ipAddress?: string | null;
    userAgent?: string | null;
    requestPayload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from('audit_logs').insert({
    user_id: input.userId ?? null,
    event_type: input.eventType,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    request_payload: redactAuditPayload(input.requestPayload ?? {}),
  });
  if (error) {
    console.error('audit_logs insert failed', error.message);
  }
}
