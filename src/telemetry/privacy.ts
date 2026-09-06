import { hmacHex, shortHash } from '../util/hash.ts';
import { truncateIp } from '../util/ip.ts';
import { dayKey } from '../util/time.ts';
import { scrub } from '../util/text.ts';
import type { Config } from '../config.ts';

export interface IpFields {
  ip_trunc: string | null;
  ip_hash: string | null;
}

// the ip never lands in the db in a form that reverses. truncation keeps the
// routing prefix (enough for "same network" reasoning), the hash rotates with
// a daily salt so it links within a day and dissolves after.
export function ipFields(ip: string, cfg: Config, at = Date.now()): IpFields {
  const mode = cfg.privacy.ipMode;
  const trunc = truncateIp(ip);
  let hash: string | null = null;
  if (mode === 'hash' || mode === 'truncate_hash') {
    const days = Math.max(1, cfg.privacy.ipSaltRotationDays);
    const epoch = Math.floor(at / (86_400_000 * days));
    const salt = hmacHex(cfg.secretKey, `ip-salt|${epoch}|${dayKey(epoch * 86_400_000 * days)}`);
    hash = hmacHex(salt, ip).slice(0, 20);
  }
  if (mode === 'none') return { ip_trunc: trunc, ip_hash: hash };
  if (mode === 'hash') return { ip_trunc: null, ip_hash: hash };
  return { ip_trunc: trunc, ip_hash: hash };
}

// what we keep verbatim from headers. everything else is names-only.
export const HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'accept-encoding',
  'user-agent',
  'referer',
  'host',
  'from',
  'dnt',
  'upgrade-insecure-requests',
  'cache-control',
  'pragma',
  'if-modified-since',
  'if-none-match',
  'x-requested-with',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'purpose',
  'x-purpose',
  'sec-purpose',
  'te',
  'connection',
  'range',
]);

// headers we never even record the value length of
export const HEADER_DENYLIST = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key', 'x-auth-token']);

export function extraHeaderFields(headers: Record<string, string>, cfg: Config): Record<string, string> {
  const out: Record<string, string> = {};
  if (cfg.privacy.headerCapture === 'names_only') return out;
  for (const name of ['from', 'dnt', 'upgrade-insecure-requests', 'x-requested-with', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'purpose', 'x-purpose', 'sec-purpose', 'cache-control', 'pragma', 'range', 'if-modified-since', 'if-none-match']) {
    const v = headers[name];
    if (v !== undefined) out[name] = scrub(v, 256);
  }
  return out;
}

const SENSITIVE_QUERY = /^(token|key|api[_-]?key|auth|password|passwd|pwd|secret|session|sid|access[_-]?token|bearer)$/i;

export function sanitizeQuery(q: URLSearchParams, cfg: Config): Record<string, string> | null {
  if (cfg.privacy.queryCapture === 'none') return null;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of q) {
    if (n++ >= 24) break;
    const key = scrub(k, 64);
    if (SENSITIVE_QUERY.test(key)) {
      out[key] = `<redacted:${v.length}>`;
      continue;
    }
    out[key] = scrub(v, 256);
  }
  return out;
}

export interface RefererFields {
  referer: string | null; // internal: path; external: host only
  internal: boolean;
}

export function refererFields(referer: string | undefined, publicHosts: string[]): RefererFields {
  if (!referer) return { referer: null, internal: false };
  try {
    const u = new URL(referer);
    const host = u.host.toLowerCase();
    const internal = publicHosts.some((h) => h && (host === h || host.endsWith('.' + h))) || host.startsWith('localhost') || host.startsWith('127.');
    if (internal) return { referer: scrub(u.pathname + (u.search ? '?' + u.search.slice(1, 200) : ''), 512), internal: true };
    return { referer: scrub(host, 253), internal: false };
  } catch {
    // relative or garbage referer; keep a scrubbed bounded copy, it's a signal in itself
    return { referer: scrub(referer, 256), internal: referer.startsWith('/') };
  }
}

export function uaFields(ua: string | undefined): { ua: string | null; ua_hash: string | null } {
  if (!ua) return { ua: null, ua_hash: null };
  const clean = scrub(ua, 512);
  return { ua: clean, ua_hash: shortHash(clean) };
}
