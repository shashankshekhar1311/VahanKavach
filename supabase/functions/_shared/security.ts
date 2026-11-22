/**
 * Module 4 — Edge Function security: rate limiting, plate sanitization, headers.
 *
 * Rate limiter is an in-memory sliding window (per Deno isolate). Suitable for
 * scraper throttling; for multi-isolate hard caps, pair with DB/Redis later.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Classic RTO plate after strip/uppercase (e.g. KA01AB1234). */
export const INDIAN_REG_STRICT_PATTERN =
  /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;

/** Bharat Series plate (e.g. 22BH1234AA). */
export const INDIAN_BHARAT_SERIES_PATTERN =
  /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;

export function isStrictIndianVehicleNumber(sanitized: string): boolean {
  return (
    INDIAN_REG_STRICT_PATTERN.test(sanitized) ||
    INDIAN_BHARAT_SERIES_PATTERN.test(sanitized)
  );
}

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

/** Free-tier daily paid (non-cache) upstream lookups. */
export const DEFAULT_DAILY_LOOKUP_QUOTA = 3;

/** Pro-tier daily paid upstream lookups (env LOOKUP_MAX_DAILY_PRO). */
export function dailyLookupQuotaForPro(): number {
  const raw = Deno.env.get('LOOKUP_MAX_DAILY_PRO')?.trim();
  const n = raw ? Number(raw) : 30;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

/**
 * DB-backed rolling 24h quota via public.check_user_lookup_quota.
 * Counts only is_cache_hit = false rows.
 */
export async function assertUserLookupQuota(
  admin: SupabaseClient,
  userId: string,
  maxDaily: number = DEFAULT_DAILY_LOOKUP_QUOTA,
): Promise<void> {
  const { data, error } = await admin.rpc('check_user_lookup_quota', {
    p_user_id: userId,
    p_max_daily: maxDaily,
  });

  if (error) {
    console.error('check_user_lookup_quota failed', error.message);
    throw new RateLimitError(
      3600,
      'Unable to verify lookup quota. Please try again shortly.',
    );
  }

  if (data !== true) {
    throw new RateLimitError(
      86_400,
      'Daily vehicle lookup limit reached. Please upgrade to Pro or try again tomorrow.',
    );
  }
}

// ---------------------------------------------------------------------------
// Registration sanitization
// ---------------------------------------------------------------------------

/**
 * Strip separators, uppercase, then require classic RTO or Bharat Series plate.
 * Zero upstream spend on typos — call before any DB cache write or Deepvue call.
 */
export function assertStrictIndianVehicleNumber(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new SecurityValidationError(
      'Vehicle registration is required and must match Indian plate format.',
    );
  }

  const sanitized = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  if (!isStrictIndianVehicleNumber(sanitized)) {
    throw new SecurityValidationError(
      `Invalid Indian vehicle registration: rejected "${String(raw)}". ` +
        'Expected KA01AB1234 or Bharat Series 22BH1234AA.',
    );
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// Request metadata helpers
// ---------------------------------------------------------------------------

export function clientIpFromRequest(req: Request): string {
  // Prefer platform-injected IPs; never trust first XFF hop alone (spoofable).
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf.slice(0, 128);
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 128);
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    // Right-most hop is typically the closest trusted proxy edge.
    const last = parts[parts.length - 1];
    if (last) return last.slice(0, 128);
  }
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
