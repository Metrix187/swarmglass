import { hmacHex, randomId, safeEqual } from '../util/hash.ts';
import { Lru } from '../util/lru.ts';
import type { Req } from '../http/server.ts';
import type { Config } from '../config.ts';
import { ipFields, uaFields } from './privacy.ts';
import { uaFamily } from './ua.ts';

export const SESSION_COOKIE = 'afw_session'; // looks like a plain old wiki cookie on purpose
export const IDLE_MS = 30 * 60 * 1000;
export const MAX_SEQ = 600;

export interface SessionState {
  id: string;
  actorHash: string;
  kind: 'cookie' | 'fingerprint';
  startedAt: number;
  lastSeenAt: number;
  ipTrunc: string | null;
  ipHash: string | null;
  ua: string | null;
  uaHash: string | null;
  uaFamily: string;
  cookieReturned: boolean;
  nRequests: number;
  nPages: number;
  nErrors: number;
  nHead: number;
  nPost: number;
  nDisallowed: number;
  nSubresources: number;
  nMachine: number;
  maxDepth: number;
  firstPath: string | null;
  lastPath: string | null;
  firstRefererHost: string | null;
  pages: Set<string>;
  pageOrder: string[];
  seq: string[]; // recent resource ids (bounded)
  timestamps: number[]; // bounded
  channelsFetched: Set<string>; // robots | sitemap | feed | jsonld | header | manifest | api | index | stale_index
  exposed: Set<string>; // canary ids exposed to this session
  synthetic: boolean;
  syntheticRun: string | null;
  syntheticPersona: string | null;
  cohorts: Record<string, string>;
  dirty: boolean;
  persisted: boolean;
  lastPageId: string | null;
  lastPageAt: number;
}

export interface Resolved {
  session: SessionState;
  isNew: boolean;
  resumed: boolean; // came back from the db (restart, lru eviction) instead of memory
  cookiePresent: boolean;
  cookieValid: boolean;
  setCookie: string | null;
}

// how a session that memory lost gets found again. see hydrate.ts; tests can pass a fake.
export interface SessionLoader {
  byId(id: string, at: number): SessionState | undefined;
  byActor(actorHash: string, at: number, synthetic: boolean): SessionState | undefined;
}

export class SessionStore {
  private byId = new Lru<string, SessionState>(20_000);
  private byActor = new Lru<string, string>(20_000);
  private readonly loader: SessionLoader | undefined;
  private readonly cfg: Config;
  private readonly cookieSecret: string;
  private readonly secure: boolean;

  constructor(cfg: Config, loader?: SessionLoader) {
    this.cfg = cfg;
    this.loader = loader;
    this.cookieSecret = hmacHex(cfg.secretKey, 'session-cookie');
    this.secure = cfg.public.baseUrl.startsWith('https://');
  }

  private sign(id: string): string {
    return hmacHex(this.cookieSecret, id).slice(0, 24);
  }

  private parseCookie(raw: string | undefined): string | null {
    if (!raw) return null;
    const dot = raw.indexOf('.');
    if (dot < 0) return null;
    const id = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    if (!/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{24}$/.test(sig)) return null;
    return safeEqual(this.sign(id), sig) ? id : null;
  }

  cookieValue(id: string): string {
    return `${id}.${this.sign(id)}`;
  }

  setCookieHeader(id: string): string {
    const parts = [`${SESSION_COOKIE}=${this.cookieValue(id)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=2592000'];
    if (this.secure) parts.push('Secure');
    return parts.join('; ');
  }

  // network prefix + user-agent only. accept headers legitimately vary per resource
  // (a browser asks for css differently than for html), so they would split one client into many actors.
  actorHash(req: Req, ipTrunc: string | null): string {
    const parts = [ipTrunc ?? req.clientIp, req.headers['user-agent'] ?? ''];
    return hmacHex(this.cfg.secretKey, 'actor|' + parts.join('|')).slice(0, 24);
  }

  resolve(req: Req, synthetic: { run: string; persona: string; ip?: string } | null, at = Date.now()): Resolved {
    const ip = synthetic?.ip ?? req.clientIp;
    const ipf = ipFields(ip, this.cfg, at);
    const actorHash = this.actorHash(req, ipf.ip_trunc);
    const cookieRaw = req.cookies[SESSION_COOKIE];
    const cookiePresent = cookieRaw !== undefined;
    const cookieId = this.parseCookie(cookieRaw);
    const cookieValid = cookieId !== null;

    let session: SessionState | undefined;
    let resumed = false;
    if (cookieId) {
      session = this.byId.get(cookieId);
      if (!session && this.loader) {
        // memory lost it (restart, lru eviction) but the row is still open in the db: carry on where it left off
        session = this.loader.byId(cookieId, at);
        if (session) {
          this.byId.set(session.id, session);
          resumed = true;
        }
      }
      if (session && at - session.lastSeenAt > IDLE_MS) session = undefined; // stale cookie: new session, keep continuity via actor
    }
    if (!session) {
      const candidate = this.byActor.get(actorHash);
      if (candidate) {
        const s = this.byId.get(candidate);
        if (s && at - s.lastSeenAt <= IDLE_MS && s.synthetic === Boolean(synthetic)) session = s;
      }
      if (!session && this.loader) {
        // same for cookieless visitors: the actor's open session, if it is still inside the window
        const s = this.loader.byActor(actorHash, at, Boolean(synthetic));
        if (s) {
          this.byId.set(s.id, s);
          session = s;
          resumed = true;
        }
      }
    }

    let isNew = false;
    let setCookie: string | null = null;
    if (!session) {
      isNew = true;
      const id = randomId(16);
      const ua = uaFields(req.headers['user-agent']);
      session = {
        id,
        actorHash,
        kind: 'fingerprint',
        startedAt: at,
        lastSeenAt: at,
        ipTrunc: ipf.ip_trunc,
        ipHash: ipf.ip_hash,
        ua: ua.ua,
        uaHash: ua.ua_hash,
        uaFamily: uaFamily(ua.ua).family,
        cookieReturned: false,
        nRequests: 0,
        nPages: 0,
        nErrors: 0,
        nHead: 0,
        nPost: 0,
        nDisallowed: 0,
        nSubresources: 0,
        nMachine: 0,
        maxDepth: 0,
        firstPath: null,
        lastPath: null,
        firstRefererHost: null,
        pages: new Set(),
        pageOrder: [],
        seq: [],
        timestamps: [],
        channelsFetched: new Set(),
        exposed: new Set(),
        synthetic: Boolean(synthetic),
        syntheticRun: synthetic?.run ?? null,
        syntheticPersona: synthetic?.persona ?? null,
        cohorts: {},
        dirty: true,
        persisted: false,
        lastPageId: null,
        lastPageAt: 0,
      };
      this.byId.set(id, session);
      setCookie = this.setCookieHeader(id);
    } else if (cookieValid && cookieId === session.id) {
      if (!session.cookieReturned) session.dirty = true;
      session.cookieReturned = true;
      session.kind = 'cookie';
    } else if (!cookieValid) {
      // returning actor without cookie: re-offer one. (we do not re-offer when they present
      // a valid cookie for a *different* session — that's a signal, and we log it as such)
      setCookie = this.setCookieHeader(session.id);
    }
    this.byActor.set(actorHash, session.id);
    return { session, isNew, resumed, cookiePresent, cookieValid, setCookie };
  }

  get(id: string): SessionState | undefined {
    return this.byId.get(id);
  }

  // sessions with unflushed changes; caller resets dirty
  dirtySessions(): SessionState[] {
    const out: SessionState[] = [];
    for (const [, s] of this.byId.entries()) if (s.dirty) out.push(s);
    return out;
  }

  // sessions idle beyond the window that are still marked open in memory
  expired(at = Date.now()): SessionState[] {
    const out: SessionState[] = [];
    for (const [, s] of this.byId.entries()) if (at - s.lastSeenAt > IDLE_MS) out.push(s);
    return out;
  }

  evict(id: string): void {
    this.byId.delete(id);
  }

  size(): number {
    return this.byId.size;
  }
}
