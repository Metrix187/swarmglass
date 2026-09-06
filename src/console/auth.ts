import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import type { Req, Res } from '../http/server.ts';
import { AttemptLimiter } from '../http/security.ts';
import { randomToken, safeEqual } from '../util/hash.ts';
import { inAnyCidr, truncateIp } from '../util/ip.ts';

// console auth: one user from config, scrypt-hashed password, server-side sessions,
// csrf double-submit on every state change, optional ip allowlist. small on purpose.

export const CONSOLE_COOKIE = 'sg_console';
const SESSION_TTL = 12 * 3600 * 1000;

export function hashPassword(password: string): string {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N, r, p });
  return `$scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts[1] !== 'scrypt' || parts.length !== 7) return false;
    const N = Number(parts[2]);
    const r = Number(parts[3]);
    const p = Number(parts[4]);
    const salt = Buffer.from(parts[5] as string, 'base64');
    const expected = Buffer.from(parts[6] as string, 'base64');
    const actual = scryptSync(password, salt, expected.length, { N, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export interface ConsoleSession {
  id: string;
  user: string;
  csrf: string;
  expires_at: number;
}

export class ConsoleAuth {
  private readonly cfg: Config;
  private readonly db: Db;
  private readonly attempts = new AttemptLimiter(5, 10 * 60_000);
  private readonly secure: boolean;

  constructor(cfg: Config, db: Db) {
    this.cfg = cfg;
    this.db = db;
    this.secure = cfg.console.baseUrl.startsWith('https://');
  }

  ipAllowed(ip: string): boolean {
    const list = this.cfg.console.ipAllowlist;
    if (!list.length) return true;
    return inAnyCidr(list, ip);
  }

  loginAllowed(ip: string): boolean {
    return this.attempts.allowed(truncateIp(ip) ?? ip);
  }

  recordAttempt(ip: string): void {
    this.attempts.record(truncateIp(ip) ?? ip);
  }

  checkCredentials(user: string, password: string): boolean {
    if (!safeEqual(user, this.cfg.console.user)) {
      // still burn the same time as a real check
      verifyPassword(password, this.cfg.console.passwordHash || hashPassword('x'));
      return false;
    }
    if (this.cfg.console.passwordHash) return verifyPassword(password, this.cfg.console.passwordHash);
    if (!this.cfg.isProd && this.cfg.console.devPassword) return safeEqual(password, this.cfg.console.devPassword);
    return false;
  }

  createSession(user: string, ip: string): { session: ConsoleSession; cookie: string } {
    const id = randomToken(32);
    const csrf = randomToken(24);
    const now = Date.now();
    const expires = now + SESSION_TTL;
    this.db.run('INSERT INTO console_sessions (id, user, created_at, expires_at, csrf, ip_trunc) VALUES (?, ?, ?, ?, ?, ?)', id, user, now, expires, csrf, truncateIp(ip));
    this.db.run('INSERT INTO audit_log (ts, user, action, detail) VALUES (?, ?, ?, ?)', now, user, 'login', truncateIp(ip));
    return { session: { id, user, csrf, expires_at: expires }, cookie: this.cookie(id, SESSION_TTL / 1000) };
  }

  private cookie(id: string, maxAge: number): string {
    const parts = [`${CONSOLE_COOKIE}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
    if (this.secure) parts.push('Secure');
    return parts.join('; ');
  }

  clearCookie(): string {
    return this.cookie('', 0);
  }

  sessionFor(req: Req): ConsoleSession | null {
    const id = req.cookies[CONSOLE_COOKIE];
    if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) return null;
    const row = this.db.get<{ id: string; user: string; csrf: string; expires_at: number }>('SELECT id, user, csrf, expires_at FROM console_sessions WHERE id = ?', id);
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  }

  destroy(req: Req): void {
    const id = req.cookies[CONSOLE_COOKIE];
    if (id) this.db.run('DELETE FROM console_sessions WHERE id = ?', id);
  }

  csrfOk(req: Req, session: ConsoleSession): boolean {
    const h = req.headers['x-csrf'];
    if (h) return safeEqual(h, session.csrf);
    // form posts carry it as a field
    if (req.body && (req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) {
      const form = new URLSearchParams(req.body.toString('utf8'));
      const t = form.get('csrf');
      return Boolean(t && safeEqual(t, session.csrf));
    }
    return false;
  }

  audit(user: string, action: string, detail: string): void {
    this.db.run('INSERT INTO audit_log (ts, user, action, detail) VALUES (?, ?, ?, ?)', Date.now(), user, action, detail.slice(0, 500));
  }
}

export function forbidden(msg = 'forbidden'): Res {
  return { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: msg }), meta: { noStore: true } };
}
