import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import type { BufferedWriter } from '../db/writer.ts';
import type { Logger } from '../log.ts';
import type { Req, Res } from '../http/server.ts';
import { bodyBytes } from '../http/server.ts';
import { safeEqual, shortHash } from '../util/hash.ts';
import { scrub } from '../util/text.ts';
import { acceptProfile } from '../http/negotiate.ts';
import { malformationFlags } from '../http/security.ts';
import { extraHeaderFields, refererFields, sanitizeQuery } from './privacy.ts';
import { SessionStore, MAX_SEQ, type SessionState } from './session.ts';
import { sessionLoader } from './hydrate.ts';
import { CanaryService, type Canary, type Sighting } from './canary.ts';
import { LiveBus } from './bus.ts';
import { RateLimiter } from '../http/security.ts';

export interface ResMeta {
  route?: string;
  pageId?: string;
  kind?: string; // resource_kind
  discover?: string;
  depth?: number;
  negotiated?: string;
  canaries?: Canary[];
  robotsDisallowed?: boolean;
  channel?: string; // when the resource *is* a discovery channel: robots|sitemap|feed|manifest|api|index|stale_index
  malformed?: string[];
  noStore?: boolean; // e.g. console health checks
}

export interface SyntheticTag {
  run: string;
  persona: string;
  ip?: string;
}

const MACHINE_KINDS = new Set(['robots', 'sitemap', 'feed', 'manifest', 'api', 'index', 'stale_index', 'alt']);
const PAGE_KINDS = new Set(['page', 'special', 'alt', 'attachment', 'redirect', 'missing', 'gone']);
const SUBRESOURCE_KINDS = new Set(['asset']);

export class Telemetry {
  readonly cfg: Config;
  readonly db: Db;
  readonly writer: BufferedWriter;
  readonly log: Logger;
  readonly sessions: SessionStore;
  readonly canaries: CanaryService;
  readonly bus = new LiveBus();
  readonly limiter: RateLimiter;
  private readonly publicHosts: string[];
  private exposureCache = new Map<string, Set<string>>(); // canary -> session ids (bounded via sessions LRU semantics)
  private seenRuns = new Set<string>();
  stats = { requests: 0, sightings: 0, newSessions: 0, resumed: 0, limited: 0, malformed: 0 };

  constructor(opts: { cfg: Config; db: Db; writer: BufferedWriter; log: Logger; canaries: CanaryService }) {
    this.cfg = opts.cfg;
    this.db = opts.db;
    this.writer = opts.writer;
    this.log = opts.log;
    this.canaries = opts.canaries;
    this.sessions = new SessionStore(opts.cfg, sessionLoader(opts.db));
    this.limiter = new RateLimiter(opts.cfg.limits.rateRps, opts.cfg.limits.rateBurst);
    const hosts: string[] = [];
    try {
      hosts.push(new URL(opts.cfg.public.baseUrl).host.toLowerCase());
    } catch {
      // dev
    }
    this.publicHosts = hosts;
  }

  // header: X-Swarmglass-Synthetic: <token>:<run>:<persona>[:<ip>]
  syntheticTag(req: Req): SyntheticTag | null {
    const h = req.headers['x-swarmglass-synthetic'];
    if (!h || !this.cfg.synthToken) return null;
    const [token, run, persona, ip] = h.split(':');
    if (!token || !run || !persona) return null;
    if (!safeEqual(token, this.cfg.synthToken)) return null;
    return { run: scrub(run, 64), persona: scrub(persona, 64), ip: ip ? scrub(ip, 64) : undefined };
  }

  // runs before routing. resolves the session, applies the rate limit.
  gate(req: Req): Res | null {
    const synthetic = this.syntheticTag(req);
    const resolved = this.sessions.resolve(req, synthetic);
    req.state.session = resolved.session;
    req.state.sessionNew = resolved.isNew;
    if (resolved.resumed) {
      this.stats.resumed++;
      this.log.info('session resumed from db', { id: resolved.session.id.slice(0, 10), requests: resolved.session.nRequests });
    }
    req.state.cookiePresent = resolved.cookiePresent;
    req.state.cookieValid = resolved.cookieValid;
    req.state.synthetic = synthetic;
    if (resolved.setCookie) req.state.extraHeaders = { 'set-cookie': resolved.setCookie };

    const key = resolved.session.ipTrunc ?? req.clientIp;
    const retry = this.limiter.check(key);
    if (retry > 0) {
      this.stats.limited++;
      return {
        status: 429,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': String(retry) },
        body: 'Too many requests. Please slow down.\n',
        meta: { route: 'rate_limited', kind: 'other' },
      };
    }
    return null;
  }

  onResponse(req: Req, res: Res, latencyMs: number): void {
    const meta = (res.meta ?? {}) as ResMeta;
    if (meta.noStore) return;
    const at = Date.now();
    let session = req.state.session as SessionState | undefined;
    const synthetic = (req.state.synthetic as SyntheticTag | null | undefined) ?? null;
    if (!session) {
      // clientError path (no gate ran) — resolve now so even garbage gets a session
      const r = this.sessions.resolve(req, synthetic, at);
      session = r.session;
      req.state.sessionNew = r.isNew;
    }
    const isNew = Boolean(req.state.sessionNew);
    if (isNew) this.stats.newSessions++;
    this.stats.requests++;
    if (synthetic && !this.seenRuns.has(synthetic.run)) {
      this.seenRuns.add(synthetic.run);
      const run = synthetic.run;
      const persona = synthetic.persona;
      this.writer.enqueue(() => {
        this.db.run('INSERT OR IGNORE INTO synthetic_runs (id, started_at, personas_json, note) VALUES (?, ?, ?, ?)', run, at, JSON.stringify([persona]), 'self-registered from traffic');
        this.db.run("UPDATE synthetic_runs SET personas_json = json_insert(personas_json, '$[#]', ?), finished_at = ? WHERE id = ? AND personas_json NOT LIKE ?", persona, at, run, `%"${persona}"%`);
      });
    } else if (synthetic) {
      const run = synthetic.run;
      const persona = synthetic.persona;
      const key = run + '|' + persona;
      if (!this.seenRuns.has(key)) {
        this.seenRuns.add(key);
        this.writer.enqueue(() => {
          this.db.run("UPDATE synthetic_runs SET personas_json = json_insert(personas_json, '$[#]', ?), finished_at = ? WHERE id = ? AND personas_json NOT LIKE ?", persona, at, run, `%"${persona}"%`);
        });
      }
    }

    const kind = meta.kind ?? (meta.route === 'missing' ? 'missing' : 'other');
    const flags = [...(meta.malformed ?? []), ...malformationFlags(req.url, req.headers, req.rawMethod)];
    if (req.bodyTruncated) flags.push('body_truncated');
    if (flags.length) this.stats.malformed++;
    const ref = refererFields(req.headers['referer'], this.publicHosts);
    const sightings = CanaryService.scanRequest(req);
    const exposed = meta.canaries ?? [];

    // ---- session in-memory update ----
    const s = session;
    s.nRequests++;
    s.lastSeenAt = at;
    s.dirty = true;
    if (s.firstPath === null) s.firstPath = scrub(req.path, 512);
    s.lastPath = scrub(req.path, 512);
    if (s.firstRefererHost === null && !ref.internal && ref.referer) s.firstRefererHost = ref.referer;
    if (req.method === 'HEAD') s.nHead++;
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') s.nPost++;
    if (res.status >= 400) s.nErrors++;
    if (meta.robotsDisallowed && res.status < 400) s.nDisallowed++;
    if (SUBRESOURCE_KINDS.has(kind)) s.nSubresources++;
    if (MACHINE_KINDS.has(kind)) s.nMachine++;
    if (meta.channel) s.channelsFetched.add(meta.channel);
    if (typeof meta.depth === 'number' && meta.depth > s.maxDepth) s.maxDepth = meta.depth;
    if (s.seq.length < MAX_SEQ) s.seq.push(meta.pageId ?? `${kind}:${scrub(req.path, 80)}`);
    if (s.timestamps.length < MAX_SEQ) s.timestamps.push(at);

    // ---- discovery attribution ----
    let discovery: { via: string; orderNo: number } | null = null;
    let edge: { from: string; kind: 'referer' | 'sequence' } | null = null;
    const isPageHit = meta.pageId && PAGE_KINDS.has(kind) && res.status < 400;
    if (isPageHit) {
      const pageId = meta.pageId as string;
      s.nPages++;
      const refPage = ref.internal && ref.referer ? pageIdFromPath(ref.referer, this.cfg.public.basePath) : null;
      if (refPage && refPage !== pageId) edge = { from: refPage, kind: 'referer' };
      else if (!refPage && s.lastPageId && s.lastPageId !== pageId && at - s.lastPageAt < 60_000) edge = { from: s.lastPageId, kind: 'sequence' };
      if (!s.pages.has(pageId)) {
        s.pages.add(pageId);
        s.pageOrder.push(pageId);
        let via = 'direct';
        if (edge?.kind === 'referer') via = `referer:${edge.from}`;
        else {
          const cls = meta.discover ?? 'visible';
          const channel = channelFor(cls);
          if (channel && s.channelsFetched.has(channel)) via = `channel:${channel}`;
          else if (edge?.kind === 'sequence') via = `sequence:${edge.from}`;
          else if (channel) via = `unknown:${cls}`;
        }
        discovery = { via, orderNo: s.pageOrder.length };
      }
      s.lastPageId = pageId;
      s.lastPageAt = at;
    }

    // ---- canary exposure + sighting bookkeeping ----
    const newExposures: Canary[] = [];
    for (const c of exposed) {
      if (!s.exposed.has(c.id)) {
        s.exposed.add(c.id);
        newExposures.push(c);
      }
      let set = this.exposureCache.get(c.id);
      if (!set) {
        set = new Set();
        this.exposureCache.set(c.id, set);
        if (this.exposureCache.size > 50_000) this.exposureCache.clear();
      }
      set.add(s.id);
    }
    const enriched = sightings.map((sg) => this.enrichSighting(sg, s, at));
    if (enriched.length) this.stats.sightings += enriched.length;

    // ---- persist ----
    const sessionSnapshot = isNew || !s.persisted ? snapshotForInsert(s) : null;
    if (sessionSnapshot) s.persisted = true;
    const row = {
      ts: at,
      session_id: s.id,
      actor_hash: s.actorHash,
      method: req.rawMethod ? scrub(req.rawMethod, 16) : 'OTHER',
      path: scrub(req.path, 1024),
      route_id: meta.route ?? null,
      page_id: meta.pageId ?? null,
      resource_kind: kind,
      discover_class: meta.discover ?? null,
      depth: typeof meta.depth === 'number' ? meta.depth : null,
      status: res.status,
      latency_ms: Math.round(latencyMs * 100) / 100,
      bytes_out: req.method === 'HEAD' ? 0 : bodyBytes(res),
      http_version: req.httpVersion || null,
      proto: req.proto,
      host: scrub(req.host, 253) || null,
      ua_hash: s.uaHash,
      accept: req.headers['accept'] ? scrub(req.headers['accept'], 256) : null,
      accept_lang: req.headers['accept-language'] ? scrub(req.headers['accept-language'], 128) : null,
      accept_enc: req.headers['accept-encoding'] ? scrub(req.headers['accept-encoding'], 128) : null,
      referer: ref.referer,
      referer_internal: ref.internal,
      query_json: (() => {
        const q = sanitizeQuery(req.query, this.cfg);
        return q && Object.keys(q).length ? JSON.stringify(q) : null;
      })(),
      header_names: req.rawHeaderNames.slice(0, 64).join(','),
      header_order_hash: shortHash(req.rawHeaderNames.join(','), 12),
      header_count: req.headerCount,
      cookie_present: Boolean(req.state.cookiePresent),
      cookie_valid: Boolean(req.state.cookieValid),
      negotiated: meta.negotiated ?? null,
      robots_disallowed: Boolean(meta.robotsDisallowed),
      canaries_exposed: exposed.length ? JSON.stringify(exposed.map((c) => c.id)) : null,
      canaries_seen: enriched.length ? JSON.stringify(enriched.map((e) => ({ id: e.id, where: e.where }))) : null,
      cohorts_json: Object.keys(s.cohorts).length ? JSON.stringify(s.cohorts) : null,
      synthetic: s.synthetic,
      synthetic_run: s.syntheticRun,
      malformed: flags.length ? JSON.stringify(flags.slice(0, 16)) : null,
      body_bytes: req.body ? req.body.length : 0,
      body_ctype: req.headers['content-type'] ? scrub(req.headers['content-type'], 64) : null,
      extra_json: (() => {
        const extra: Record<string, unknown> = extraHeaderFields(req.headers, this.cfg);
        extra.accept_profile = acceptProfile(req.headers['accept']);
        if (req.state.clientError) extra.client_error = req.state.clientError;
        if (synthetic) extra.synthetic_persona = synthetic.persona;
        return JSON.stringify(extra);
      })(),
    };

    this.writer.enqueue(() => {
      if (sessionSnapshot) {
        this.db.run(
          `INSERT OR IGNORE INTO sessions (id, actor_hash, kind, started_at, last_seen_at, ip_trunc, ip_hash, ua, ua_hash, ua_family, cookie_returned, synthetic, synthetic_run, synthetic_persona, first_path, cohorts_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sessionSnapshot.id,
          sessionSnapshot.actor_hash,
          sessionSnapshot.kind,
          sessionSnapshot.started_at,
          sessionSnapshot.last_seen_at,
          sessionSnapshot.ip_trunc,
          sessionSnapshot.ip_hash,
          sessionSnapshot.ua,
          sessionSnapshot.ua_hash,
          sessionSnapshot.ua_family,
          sessionSnapshot.cookie_returned,
          sessionSnapshot.synthetic,
          sessionSnapshot.synthetic_run,
          sessionSnapshot.synthetic_persona,
          sessionSnapshot.first_path,
          sessionSnapshot.cohorts_json,
        );
      }
      if (!this.writer.degraded) {
        this.db.run(
          `INSERT INTO events (ts, session_id, actor_hash, method, path, route_id, page_id, resource_kind, discover_class, depth, status, latency_ms, bytes_out, http_version, proto, host, ua_hash, accept, accept_lang, accept_enc, referer, referer_internal, query_json, header_names, header_order_hash, header_count, cookie_present, cookie_valid, negotiated, robots_disallowed, canaries_exposed, canaries_seen, cohorts_json, synthetic, synthetic_run, malformed, body_bytes, body_ctype, extra_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.ts, row.session_id, row.actor_hash, row.method, row.path, row.route_id, row.page_id, row.resource_kind, row.discover_class, row.depth, row.status, row.latency_ms, row.bytes_out, row.http_version, row.proto, row.host, row.ua_hash, row.accept, row.accept_lang, row.accept_enc, row.referer, row.referer_internal, row.query_json, row.header_names, row.header_order_hash, row.header_count, row.cookie_present, row.cookie_valid, row.negotiated, row.robots_disallowed, row.canaries_exposed, row.canaries_seen, row.cohorts_json, row.synthetic, row.synthetic_run, row.malformed, row.body_bytes, row.body_ctype, row.extra_json,
        );
      }
      for (const c of newExposures) {
        this.db.run('INSERT OR IGNORE INTO canary_exposures (canary_id, session_id, actor_hash, first_at, placement) VALUES (?, ?, ?, ?, ?)', c.id, s.id, s.actorHash, at, c.placement);
      }
      for (const e of enriched) {
        this.db.run(
          `INSERT INTO canary_sightings (ts, canary_id, session_id, actor_hash, seen_in, path, detail, cross_session, cross_actor, exposure_session_id, delta_ms, external, synthetic)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          at, e.id, s.id, s.actorHash, e.where, scrub(req.path, 512), e.detail, e.crossSession, e.crossActor, e.exposureSession, e.deltaMs, s.synthetic,
        );
      }
      if (discovery && meta.pageId) {
        this.db.run(
          'INSERT OR IGNORE INTO page_discoveries (session_id, page_id, ts, via, discover_class, depth, order_no) VALUES (?, ?, ?, ?, ?, ?, ?)',
          s.id, meta.pageId, at, discovery.via, meta.discover ?? null, typeof meta.depth === 'number' ? meta.depth : null, discovery.orderNo,
        );
      }
      if (edge && meta.pageId) {
        this.db.run('INSERT INTO nav_edges (session_id, from_page, to_page, ts, kind) VALUES (?, ?, ?, ?, ?)', s.id, edge.from, meta.pageId, at, edge.kind);
      }
    });

    this.bus.publish({
      ts: at,
      session_id: s.id,
      method: row.method,
      path: row.path,
      status: res.status,
      latency_ms: row.latency_ms,
      kind,
      page_id: meta.pageId ?? null,
      ua_family: s.uaFamily,
      synthetic: s.synthetic,
      canaries_seen: enriched.length,
      canaries_exposed: exposed.length,
      is_new_session: isNew,
    });
  }

  private enrichSighting(sg: Sighting, s: SessionState, at: number): Sighting & { crossSession: boolean; crossActor: boolean; exposureSession: string | null; deltaMs: number | null } {
    const exposedHere = s.exposed.has(sg.id);
    let exposureSession: string | null = null;
    let exposureActor: string | null = null;
    let firstAt: number | null = null;
    const cached = this.exposureCache.get(sg.id);
    if (cached) {
      for (const sid of cached) {
        if (sid !== s.id) {
          exposureSession = sid;
          const other = this.sessions.get(sid);
          exposureActor = other?.actorHash ?? null;
          break;
        }
      }
    }
    try {
      const row = this.db.get<{ session_id: string; actor_hash: string; first_at: number }>(
        'SELECT session_id, actor_hash, first_at FROM canary_exposures WHERE canary_id = ? ORDER BY first_at ASC LIMIT 1',
        sg.id,
      );
      if (row) {
        firstAt = row.first_at;
        if (row.session_id !== s.id) {
          exposureSession = row.session_id;
          exposureActor = row.actor_hash;
        }
      }
    } catch {
      // db hiccup: still record the sighting
    }
    const known = this.canaries.lookup(sg.id);
    const crossSession = !exposedHere && (exposureSession !== null || (known?.scope === 'S' && known.sessionId !== s.id));
    const crossActor = crossSession && exposureActor !== null && exposureActor !== s.actorHash;
    return { ...sg, crossSession, crossActor, exposureSession: exposedHere ? s.id : exposureSession, deltaMs: firstAt ? at - firstAt : null };
  }

  // periodic: write dirty session counters
  flushSessions(): number {
    const dirty = this.sessions.dirtySessions();
    for (const s of dirty) {
      s.dirty = false;
      const snap = snapshotForUpdate(s);
      this.writer.enqueue(() => {
        this.db.run(
          `UPDATE sessions SET last_seen_at = ?, kind = ?, cookie_returned = ?, n_requests = ?, n_pages = ?, n_unique_pages = ?, n_errors = ?, n_head = ?, n_post = ?, n_disallowed = ?, n_subresources = ?, n_machine = ?, max_depth = ?, first_path = ?, last_path = ?, first_referer_host = ?, cohorts_json = ?, ua_family = ?
           WHERE id = ?`,
          snap.last_seen_at, snap.kind, snap.cookie_returned, snap.n_requests, snap.n_pages, snap.n_unique_pages, snap.n_errors, snap.n_head, snap.n_post, snap.n_disallowed, snap.n_subresources, snap.n_machine, snap.max_depth, snap.first_path, snap.last_path, snap.first_referer_host, snap.cohorts_json, snap.ua_family, s.id,
        );
      });
    }
    return dirty.length;
  }

  // periodic: close idle sessions and drop them from memory
  expireSessions(at = Date.now()): number {
    const expired = this.sessions.expired(at);
    for (const s of expired) {
      const last = s.lastSeenAt;
      this.writer.enqueue(() => {
        this.db.run('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL', last, s.id);
      });
      this.sessions.evict(s.id);
    }
    return expired.length;
  }
}

// map a discoverability class to the channel a session must have fetched to "legitimately" find it
export function channelFor(discoverClass: string): string | null {
  switch (discoverClass) {
    case 'robots_only':
      return 'robots';
    case 'sitemap_only':
      return 'sitemap';
    case 'feed_only':
      return 'feed';
    case 'manifest_only':
      return 'manifest';
    case 'api_only':
      return 'api';
    case 'index_only':
      return 'index';
    case 'stale_index_only':
      return 'stale_index';
    case 'jsonld_only':
    case 'og_only':
    case 'header_only':
    case 'comment_only':
    case 'link_only':
      return discoverClass.replace('_only', '');
    default:
      return null;
  }
}

export function pageIdFromPath(path: string, basePath: string): string | null {
  let p = path.split('?')[0] ?? '';
  if (basePath && p.startsWith(basePath)) p = p.slice(basePath.length);
  const m = p.match(/^\/wiki\/([^/]+?)(?:\.(json|txt|yaml|yml))?$/);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]).replace(/ /g, '_');
  } catch {
    return m[1];
  }
}

function snapshotForInsert(s: SessionState) {
  return {
    id: s.id,
    actor_hash: s.actorHash,
    kind: s.kind,
    started_at: s.startedAt,
    last_seen_at: s.lastSeenAt,
    ip_trunc: s.ipTrunc,
    ip_hash: s.ipHash,
    ua: s.ua,
    ua_hash: s.uaHash,
    ua_family: s.uaFamily,
    cookie_returned: s.cookieReturned,
    synthetic: s.synthetic,
    synthetic_run: s.syntheticRun,
    synthetic_persona: s.syntheticPersona,
    first_path: s.firstPath,
    cohorts_json: Object.keys(s.cohorts).length ? JSON.stringify(s.cohorts) : null,
  };
}

function snapshotForUpdate(s: SessionState) {
  return {
    last_seen_at: s.lastSeenAt,
    kind: s.kind,
    cookie_returned: s.cookieReturned,
    n_requests: s.nRequests,
    n_pages: s.nPages,
    n_unique_pages: s.pages.size,
    n_errors: s.nErrors,
    n_head: s.nHead,
    n_post: s.nPost,
    n_disallowed: s.nDisallowed,
    n_subresources: s.nSubresources,
    n_machine: s.nMachine,
    max_depth: s.maxDepth,
    first_path: s.firstPath,
    last_path: s.lastPath,
    first_referer_host: s.firstRefererHost,
    cohorts_json: Object.keys(s.cohorts).length ? JSON.stringify(s.cohorts) : null,
    ua_family: s.uaFamily,
  };
}
