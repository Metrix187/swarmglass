import { hmacHex } from '../util/hash.ts';
import { scrub } from '../util/text.ts';
import { Lru } from '../util/lru.ts';
import type { Db } from '../db/db.ts';
import type { BufferedWriter } from '../db/writer.ts';
import type { Req } from '../http/server.ts';
import { armVector, cohortSlug } from './cohort.ts';

// per-session tokens. a route canary says "somebody read page X"; a session token says "session A was handed
// this exact string on page X, section Y". when session B presents it, the edge A -> B is a fact, not a guess.
//
// eight lowercase hex, derived with the secret from (session, page, section) so a page re-rendered to the same
// session carries the same token, and stored in session_tokens so the reverse lookup works after a restart.
// eight hex reads as a build hash or a checksum, which is what the prose around it says it is.

export type TokenSection = 'infobox_claim' | 'comment_archive_log' | 'export_link' | 'anomaly_ref' | 'feed_record' | 'related_changes' | 'verify_response' | 'lookup_response';

export interface IssuedToken {
  token: string;
  sessionId: string;
  actorHash: string;
  pageId: string | null;
  section: TokenSection;
  hop: number;
  armVector: string;
  cohortSlug: string;
  issuedAt: number;
  synthetic: boolean;
}

export interface TokenSighting {
  token: string;
  where: string; // path | query:<k> | referer | header:<name> | cookie:<name> | body
  detail: string;
  origin: IssuedToken;
}

// not a word boundary: Incident_Log_7a1b2c3d has an underscore before the token and \b would miss it
const TOKEN_RE = /(?<![0-9a-zA-Z])[0-9a-f]{8}(?![0-9a-zA-Z])/g;
export const TOKEN_CANARY_PREFIX = 'SGT-';

export const HOP_OF: Record<TokenSection, number> = {
  infobox_claim: 0,
  comment_archive_log: 0,
  export_link: 0,
  anomaly_ref: 1,
  feed_record: 2,
  related_changes: 3,
  verify_response: 3,
  lookup_response: 3,
};

interface SessionLike {
  id: string;
  actorHash: string;
  cohorts: Record<string, string>;
  synthetic: boolean;
}

export class SessionTokenService {
  private readonly secret: string;
  private readonly db: Db | null;
  private readonly writer: BufferedWriter | null;
  private readonly routeNo: (pageId: string) => number;
  private cache = new Lru<string, IssuedToken>(50_000);

  constructor(opts: { secret: string; db?: Db; writer?: BufferedWriter; routeNo?: (pageId: string) => number }) {
    this.secret = opts.secret;
    this.db = opts.db ?? null;
    this.writer = opts.writer ?? null;
    this.routeNo = opts.routeNo ?? (() => 0);
  }

  value(sessionId: string, pageId: string | null, section: TokenSection): string {
    return hmacHex(this.secret, `tok|${sessionId}|${pageId ?? ''}|${section}`).slice(0, 8);
  }

  mint(session: SessionLike, pageId: string | null, section: TokenSection, at = Date.now()): IssuedToken {
    const token = this.value(session.id, pageId, section);
    const vector = armVector(session.cohorts);
    const existing = this.cache.get(token);
    if (existing) {
      this.bump(token, at);
      return existing;
    }
    const issued: IssuedToken = { token, sessionId: session.id, actorHash: session.actorHash, pageId, section, hop: HOP_OF[section], armVector: vector, cohortSlug: cohortSlug(vector), issuedAt: at, synthetic: session.synthetic };
    this.cache.set(token, issued);
    this.persist(issued);
    return issued;
  }

  private persist(t: IssuedToken): void {
    const op = () => {
      if (!this.db) return;
      this.db.run(
        `INSERT INTO session_tokens (token, session_id, actor_hash, page_id, section, hop, arm_vector, cohort_slug, issued_at, last_issued_at, issue_count, synthetic)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(token) DO UPDATE SET last_issued_at = excluded.last_issued_at, issue_count = issue_count + 1`,
        t.token, t.sessionId, t.actorHash, t.pageId, t.section, t.hop, t.armVector, t.cohortSlug, t.issuedAt, t.issuedAt, t.synthetic,
      );
      // a token is a canary too, as far as the canaries tab is concerned: scope S, placement token. the id shape
      // differs from the QUANTARA- ones so the regex scanner never sees it; tokens are found by lookup instead
      const cid = TOKEN_CANARY_PREFIX + t.token;
      this.db.run(
        `INSERT INTO canaries (id, scope, route_no, page_id, placement, experiment_id, arm, session_id, seed_version, first_issued_at, last_issued_at, issue_count)
         VALUES (?, 'S', ?, ?, 'token', NULL, NULL, ?, NULL, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET last_issued_at = excluded.last_issued_at, issue_count = issue_count + 1`,
        cid, t.pageId ? this.routeNo(t.pageId) : 0, t.pageId, t.sessionId, t.issuedAt, t.issuedAt,
      );
      this.db.run('INSERT OR IGNORE INTO canary_exposures (canary_id, session_id, actor_hash, first_at, placement) VALUES (?, ?, ?, ?, ?)', cid, t.sessionId, t.actorHash, t.issuedAt, 'token');
    };
    if (this.writer) this.writer.enqueue(op);
    else op();
  }

  private bump(token: string, at: number): void {
    const op = () => {
      if (!this.db) return;
      this.db.run('UPDATE session_tokens SET last_issued_at = ?, issue_count = issue_count + 1 WHERE token = ?', at, token);
    };
    if (this.writer) this.writer.enqueue(op);
    else op();
  }

  lookup(token: string): IssuedToken | undefined {
    const hit = this.cache.get(token);
    if (hit) return hit;
    if (!this.db) return undefined;
    let row: { token: string; session_id: string; actor_hash: string; page_id: string | null; section: string; hop: number; arm_vector: string | null; cohort_slug: string | null; issued_at: number; synthetic: number } | undefined;
    try {
      row = this.db.get('SELECT token, session_id, actor_hash, page_id, section, hop, arm_vector, cohort_slug, issued_at, synthetic FROM session_tokens WHERE token = ?', token);
    } catch {
      return undefined;
    }
    if (!row) return undefined;
    const t: IssuedToken = { token: row.token, sessionId: row.session_id, actorHash: row.actor_hash, pageId: row.page_id, section: row.section as TokenSection, hop: row.hop, armVector: row.arm_vector ?? '', cohortSlug: row.cohort_slug ?? '', issuedAt: row.issued_at, synthetic: Boolean(row.synthetic) };
    this.cache.set(t.token, t);
    return t;
  }

  static candidates(text: string): string[] {
    const out = new Set<string>();
    for (const m of text.matchAll(TOKEN_RE)) out.add(m[0]);
    return [...out];
  }

  // every known token in the request, wherever it sits. candidates are eight-hex runs; only the ones we minted
  // come back, so a random hash in somebody's query string costs one cache miss and nothing else
  scanRequest(req: Req, max = 12): TokenSighting[] {
    const found: TokenSighting[] = [];
    const seen = new Set<string>();
    const push = (where: string, text: string | undefined) => {
      if (!text || found.length >= max) return;
      for (const cand of SessionTokenService.candidates(text)) {
        if (seen.has(cand)) continue;
        const origin = this.lookup(cand);
        if (!origin) continue;
        seen.add(cand);
        found.push({ token: cand, where, detail: contextAround(text, cand), origin });
      }
    };
    push('path', req.url.split('?')[0]);
    for (const [k, v] of req.query) push(`query:${scrub(k, 32)}`, v);
    push('referer', req.headers['referer']);
    for (const [name, value] of Object.entries(req.headers)) {
      if (name === 'referer' || name === 'cookie' || name === 'host' || name === 'if-none-match' || name === 'x-swarmglass-synthetic') continue;
      push(`header:${name}`, value);
    }
    for (const [k, v] of Object.entries(req.cookies)) push(`cookie:${scrub(k, 32)}`, v);
    if (req.body && req.body.length) {
      const ctype = (req.headers['content-type'] ?? '').toLowerCase();
      if (!ctype || /text|json|xml|form|yaml|javascript/.test(ctype)) push('body', req.body.subarray(0, 16_384).toString('utf8'));
    }
    return found;
  }
}

function contextAround(text: string, needle: string): string {
  const i = text.indexOf(needle);
  if (i < 0) return scrub(needle, 64);
  return scrub(text.slice(Math.max(0, i - 24), Math.min(text.length, i + needle.length + 24)), 120);
}
