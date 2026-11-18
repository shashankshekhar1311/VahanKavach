/**
 * Exponential backoff (max 3 retries) + circuit breaker for upstream transport APIs.
 * Masks Authorization / credentials in any logged payload.
 */

import { ProviderHttpError } from './surepass.provider.ts';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 250;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30_000;

type CircuitState = {
  failures: number;
  openUntil: number;
};

const circuits = new Map<string, CircuitState>();

export class CircuitOpenError extends Error {
  readonly status = 503;
  constructor(provider: string, retryAfterSec: number) {
    super(
      `Upstream provider "${provider}" circuit open. Retry after ~${retryAfterSec}s.`,
    );
    this.name = 'CircuitOpenError';
  }
}

/** Redact secrets from strings / objects before logging. */
export function maskSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[^\s'"]+/gi, '$1[REDACTED]')
      .replace(
        /(Authorization["']?\s*[:=]\s*["']?)[^"',}\s]+/gi,
        '$1[REDACTED]',
      )
      .replace(
        /(api[_-]?key|token|secret|password)(["']?\s*[:=]\s*["']?)[^"',}\s]+/gi,
        '$1$2[REDACTED]',
      );
  }
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/auth|token|secret|password|apikey|api_key|authorization/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = maskSecrets(v);
      }
    }
    return out;
  }
  return value;
}

export function safeLog(message: string, meta?: unknown): void {
  if (meta === undefined) {
    console.log(message);
    return;
  }
  console.log(message, maskSecrets(meta));
}

function isRetryableUpstream(err: unknown): boolean {
  if (err instanceof ProviderHttpError) {
    const upstream = err.upstreamStatus ?? err.status;
    return upstream === 504 || upstream === 502 || upstream === 503 ||
      err.status === 504;
  }
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && /timeout|504|gateway/i.test(err.message)) {
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCircuit(name: string): CircuitState {
  let state = circuits.get(name);
  if (!state) {
    state = { failures: 0, openUntil: 0 };
    circuits.set(name, state);
  }
  return state;
}

export function resetCircuit(name: string): void {
  circuits.delete(name);
}

/**
 * Run `fn` with exponential backoff (max 3 retries) and a per-provider circuit
 * that opens after repeated 504/gateway failures.
 */
export async function withRetryAndCircuit<T>(
  providerName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const circuit = getCircuit(providerName);
  const now = Date.now();
  if (circuit.openUntil > now) {
    const retryAfterSec = Math.ceil((circuit.openUntil - now) / 1000);
    throw new CircuitOpenError(providerName, retryAfterSec);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fn();
      circuit.failures = 0;
      circuit.openUntil = 0;
      return result;
    } catch (err) {
      lastError = err;
      const retryable = isRetryableUpstream(err);
      safeLog('upstream provider call failed', {
        provider: providerName,
        attempt: attempt + 1,
        retryable,
        error: err instanceof Error ? err.message : String(err),
        upstreamStatus:
          err instanceof ProviderHttpError ? err.upstreamStatus : undefined,
      });

      if (retryable) {
        circuit.failures += 1;
        if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
          const cooldown =
            CIRCUIT_COOLDOWN_MS * Math.min(8, 2 ** (circuit.failures - CIRCUIT_FAILURE_THRESHOLD));
          circuit.openUntil = Date.now() + cooldown;
          safeLog('circuit breaker opened', {
            provider: providerName,
            openForMs: cooldown,
            failures: circuit.failures,
          });
        }
      }

      if (!retryable || attempt === MAX_RETRIES) break;
      const delay = BASE_DELAY_MS * 2 ** attempt;
      await sleep(delay);
    }
  }

  throw lastError;
}

/** Probe latency of an upstream base URL (HEAD/GET). Returns ms or null. */
export async function probeUpstreamLatency(
  url: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; latencyMs: number | null; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    return {
      ok: res.ok || res.status < 500,
      latencyMs: Date.now() - started,
      status: res.status,
    };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
