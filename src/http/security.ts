import { Lru } from '../util/lru.ts';

// ---- security headers ----

export function publicSecurityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    // the wiki skin ships one css file and one tiny script, both same-origin.
    'content-security-policy':
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  };
}

export function consoleSecurityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow, noarchive',
    'content-security-policy':
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  };
}

// ---- token bucket rate limiter keyed by whatever the caller passes (ip_trunc, usually) ----

interface Bucket {
  tokens: number;
  updated: number;
}

export class RateLimiter {
  private buckets = new Lru<string, Bucket>(50_000);
  private readonly rps: number;
  private readonly burst: number;

  constructor(rps: number, burst: number) {
    this.rps = rps;
    this.burst = burst;
  }

  // returns retry-after seconds if limited, 0 if allowed
  check(key: string, nowMs = Date.now()): number {
    if (this.rps <= 0) return 0;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, updated: nowMs };
      this.buckets.set(key, b);
    }
    const elapsed = (nowMs - b.updated) / 1000;
    b.tokens = Math.min(this.burst, b.tokens + elapsed * this.rps);
    b.updated = nowMs;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - b.tokens) / this.rps));
  }

  size(): number {
    return this.buckets.size;
  }
}

// login attempts: fixed window, small numbers, memory bounded
export class AttemptLimiter {
  private hits = new Lru<string, number[]>(10_000);
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  allowed(key: string, nowMs = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    this.hits.set(key, arr);
    return arr.length < this.max;
  }

  record(key: string, nowMs = Date.now()): void {
    const arr = this.hits.get(key) ?? [];
    arr.push(nowMs);
    this.hits.set(key, arr);
  }
}

// ---- request-path sanity: flags weirdness without rejecting anything we can still answer ----

export function malformationFlags(rawUrl: string, headers: Record<string, string | string[] | undefined>, method: string): string[] {
  const flags: string[] = [];
  if (rawUrl.length > 2048) flags.push('url_too_long');
  if (/%00|\u0000/.test(rawUrl)) flags.push('null_byte');
  if (/(^|\/)\.\.(\/|$)/.test(rawUrl) || /%2e%2e/i.test(rawUrl)) flags.push('dot_dot');
  if (/\/\/+/.test(rawUrl.replace(/^https?:\/\//, ''))) flags.push('double_slash');
  if (/[<>"'`]/.test(rawUrl)) flags.push('html_chars_in_url');
  if (/%[0-9a-f]%|%[^0-9a-f]/i.test(rawUrl)) flags.push('bad_percent_encoding');
  if (/\\/.test(rawUrl)) flags.push('backslash');
  if (!headers['host']) flags.push('no_host');
  if (!headers['user-agent']) flags.push('no_user_agent');
  if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(method)) flags.push('unusual_method');
  const ua = String(headers['user-agent'] ?? '');
  if (ua.length > 512) flags.push('ua_too_long');
  const count = Object.keys(headers).length;
  if (count > 60) flags.push('too_many_headers');
  if (/(\bunion\b.*\bselect\b|<script|\.\.\/\.\.\/|\/etc\/passwd|cmd\.exe|\bwget\b|\bcurl\b.*\|)/i.test(decodeURIComponentSafe(rawUrl)))
    flags.push('probe_pattern');
  return flags;
}

export function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
