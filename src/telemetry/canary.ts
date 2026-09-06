import { hmacHex } from '../util/hash.ts';
import { scrub } from '../util/text.ts';
import type { Db } from '../db/db.ts';
import type { BufferedWriter } from '../db/writer.ts';
import type { Req } from '../http/server.ts';
import { Lru } from '../util/lru.ts';

// QUANTARA-SWARMGLASS-<scope><n>-<6 hex>
//   scope R = route (same for everyone; attribution by placement)
//         S = session (unique per visitor session; cross-session sighting = propagation)
//         E = experiment arm
//         C = campaign
//         X = external/manual (researcher planted, e.g. in a forum post)
export type CanaryScope = 'R' | 'S' | 'E' | 'C' | 'X';
export type Placement =
  | 'visible'
  | 'comment'
  | 'meta'
  | 'jsonld'
  | 'header'
  | 'feed'
  | 'api'
  | 'attachment'
  | 'text'
  | 'json'
  | 'yaml'
  | 'manifest'
  | 'sitemap'
  | 'robots'
  | 'title'
  | 'link';

export const CANARY_RE = /QUANTARA-SWARMGLASS-([A-Z]{1,2})(\d{0,5})-([0-9A-F]{6})/gi;
export const CANARY_FRAGMENT_RE = /QUANTARA[-_ ]?SWARMGLASS/i;

export interface Canary {
  id: string;
  scope: CanaryScope;
  routeNo: number | null;
  pageId: string | null;
  placement: Placement;
  experimentId: string | null;
  arm: string | null;
  sessionId: string | null;
}

export interface Sighting {
  id: string;
  where: string; // path | query:<k> | referer | ua | header:<name> | body | cookie
  detail: string;
}

export class CanaryService {
  private readonly secret: string;
  private readonly seedVersion: string;
  private readonly routeNo: (pageId: string) => number;
  private issued = new Lru<string, Canary>(20_000);
  private writer: BufferedWriter | null;
  private db: Db | null;

  constructor(opts: { secret: string; seedVersion: string; routeNo: (pageId: string) => number; db?: Db; writer?: BufferedWriter }) {
    this.secret = opts.secret;
    this.seedVersion = opts.seedVersion;
    this.routeNo = opts.routeNo;
    this.db = opts.db ?? null;
    this.writer = opts.writer ?? null;
  }

  private hex(key: string): string {
    return hmacHex(this.secret, `${key}|${this.seedVersion}`).slice(0, 6).toUpperCase();
  }

  private make(scope: CanaryScope, no: number, key: string, fields: Omit<Canary, 'id' | 'scope' | 'routeNo'>): Canary {
    const id = `QUANTARA-SWARMGLASS-${scope}${no}-${this.hex(`${scope}|${key}`)}`;
    const c: Canary = { id, scope, routeNo: no, ...fields };
    if (!this.issued.has(id)) {
      this.issued.set(id, c);
      this.persist(c);
    } else {
      this.bump(id);
    }
    return c;
  }

  route(pageId: string, placement: Placement): Canary {
    const no = this.routeNo(pageId);
    return this.make('R', no, `${pageId}|${placement}`, { pageId, placement, experimentId: null, arm: null, sessionId: null });
  }

  session(sessionId: string, pageId: string, placement: Placement): Canary {
    const no = this.routeNo(pageId);
    return this.make('S', no, `${sessionId}|${pageId}|${placement}`, { pageId, placement, experimentId: null, arm: null, sessionId });
  }

  experiment(experimentId: string, arm: string, placement: Placement, pageId: string | null = null): Canary {
    const no = Number((experimentId.match(/(\d+)/) ?? ['', '0'])[1]);
    return this.make('E', no, `${experimentId}|${arm}|${placement}|${pageId ?? ''}`, { pageId, placement, experimentId, arm, sessionId: null });
  }

  campaign(campaignId: string, placement: Placement): Canary {
    const no = Number((campaignId.match(/(\d+)/) ?? ['', '0'])[1]);
    return this.make('C', no, `${campaignId}|${placement}`, { pageId: null, placement, experimentId: campaignId, arm: null, sessionId: null });
  }

  external(label: string, no: number): Canary {
    return this.make('X', no, `external|${label}`, { pageId: null, placement: 'visible', experimentId: null, arm: null, sessionId: null });
  }

  private persist(c: Canary): void {
    const op = () => {
      if (!this.db) return;
      const now = Date.now();
      this.db.run(
        `INSERT INTO canaries (id, scope, route_no, page_id, placement, experiment_id, arm, session_id, seed_version, first_issued_at, last_issued_at, issue_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET last_issued_at = excluded.last_issued_at, issue_count = issue_count + 1`,
        c.id,
        c.scope,
        c.routeNo,
        c.pageId,
        c.placement,
        c.experimentId,
        c.arm,
        c.sessionId,
        this.seedVersion,
        now,
        now,
      );
    };
    if (this.writer) this.writer.enqueue(op);
    else op();
  }

  private bump(id: string): void {
    const op = () => {
      if (!this.db) return;
      this.db.run('UPDATE canaries SET last_issued_at = ?, issue_count = issue_count + 1 WHERE id = ?', Date.now(), id);
    };
    if (this.writer) this.writer.enqueue(op);
    else op();
  }

  lookup(id: string): Canary | undefined {
    const hit = this.issued.get(id);
    if (hit) return hit;
    if (!this.db) return undefined;
    const row = this.db.get<{ id: string; scope: string; route_no: number | null; page_id: string | null; placement: string; experiment_id: string | null; arm: string | null; session_id: string | null }>(
      'SELECT id, scope, route_no, page_id, placement, experiment_id, arm, session_id FROM canaries WHERE id = ?',
      id,
    );
    if (!row) return undefined;
    return {
      id: row.id,
      scope: row.scope as CanaryScope,
      routeNo: row.route_no,
      pageId: row.page_id,
      placement: row.placement as Placement,
      experimentId: row.experiment_id,
      arm: row.arm,
      sessionId: row.session_id,
    };
  }

  // ---- detection ----

  static scan(text: string): string[] {
    const out = new Set<string>();
    for (const m of text.matchAll(CANARY_RE)) {
      out.add(`QUANTARA-SWARMGLASS-${(m[1] as string).toUpperCase()}${m[2]}-${(m[3] as string).toUpperCase()}`);
    }
    return [...out];
  }

  static scanRequest(req: Req): Sighting[] {
    const found: Sighting[] = [];
    const push = (where: string, text: string | undefined) => {
      if (!text) return;
      for (const id of CanaryService.scan(text)) {
        found.push({ id, where, detail: contextAround(text, id) });
      }
    };
    push('path', req.url.split('?')[0]);
    for (const [k, v] of req.query) push(`query:${scrub(k, 32)}`, v);
    push('referer', req.headers['referer']);
    push('ua', req.headers['user-agent']);
    for (const [name, value] of Object.entries(req.headers)) {
      if (name === 'referer' || name === 'user-agent' || name === 'cookie') continue;
      push(`header:${name}`, value);
    }
    for (const [k, v] of Object.entries(req.cookies)) push(`cookie:${scrub(k, 32)}`, v);
    if (req.body && req.body.length) {
      const ctype = (req.headers['content-type'] ?? '').toLowerCase();
      const looksText = !ctype || /text|json|xml|form|yaml|javascript/.test(ctype);
      if (looksText) push('body', req.body.subarray(0, 16_384).toString('utf8'));
    }
    return found;
  }
}

function contextAround(text: string, needle: string): string {
  const i = text.indexOf(needle);
  if (i < 0) return scrub(needle, 64);
  const start = Math.max(0, i - 24);
  const end = Math.min(text.length, i + needle.length + 24);
  return scrub(text.slice(start, end), 120);
}
