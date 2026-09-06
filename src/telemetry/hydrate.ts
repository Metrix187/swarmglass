import type { Db } from '../db/db.ts';
import { IDLE_MS, MAX_SEQ, type SessionLoader, type SessionState } from './session.ts';

// a restart (or an lru eviction) used to split every running crawl in two: the cookie came back, nobody in
// memory knew it, new session. the row is still sitting in the db though, so put it back together from there.
// only sessions still inside the idle window come back; anything older is a new visit, same as before.

interface Row {
  id: string;
  actor_hash: string;
  kind: string;
  started_at: number;
  last_seen_at: number;
  ended_at: number | null;
  ip_trunc: string | null;
  ip_hash: string | null;
  ua: string | null;
  ua_hash: string | null;
  ua_family: string | null;
  cookie_returned: number;
  n_requests: number;
  n_pages: number;
  n_errors: number;
  n_head: number;
  n_post: number;
  n_disallowed: number;
  n_subresources: number;
  n_machine: number;
  max_depth: number;
  first_path: string | null;
  last_path: string | null;
  first_referer_host: string | null;
  synthetic: number;
  synthetic_run: string | null;
  synthetic_persona: string | null;
  cohorts_json: string | null;
}

const COLS =
  'id, actor_hash, kind, started_at, last_seen_at, ended_at, ip_trunc, ip_hash, ua, ua_hash, ua_family, cookie_returned, n_requests, n_pages, n_errors, n_head, n_post, n_disallowed, n_subresources, n_machine, max_depth, first_path, last_path, first_referer_host, synthetic, synthetic_run, synthetic_persona, cohorts_json';

export function sessionLoader(db: Db): SessionLoader {
  return {
    byId(id, at) {
      try {
        const row = db.get<Row>(`SELECT ${COLS} FROM sessions WHERE id = ? AND last_seen_at > ?`, id, at - IDLE_MS);
        return row ? rebuild(db, row) : undefined;
      } catch {
        return undefined; // db hiccup: a fresh session beats a crashed request
      }
    },
    byActor(actorHash, at, synthetic) {
      try {
        const row = db.get<Row>(
          `SELECT ${COLS} FROM sessions WHERE actor_hash = ? AND synthetic = ? AND last_seen_at > ? ORDER BY last_seen_at DESC LIMIT 1`,
          actorHash,
          synthetic ? 1 : 0,
          at - IDLE_MS,
        );
        return row ? rebuild(db, row) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

function rebuild(db: Db, row: Row): SessionState {
  const pageRows = db.all<{ page_id: string }>('SELECT page_id FROM page_discoveries WHERE session_id = ? ORDER BY order_no ASC', row.id);
  const exposed = db.all<{ canary_id: string }>('SELECT canary_id FROM canary_exposures WHERE session_id = ?', row.id);
  // seq/timestamps keep the *first* MAX_SEQ requests in the live path, so mirror that
  const head = db.all<{ ts: number; path: string; page_id: string | null; resource_kind: string }>(
    `SELECT ts, path, page_id, resource_kind FROM events WHERE session_id = ? ORDER BY ts ASC LIMIT ${MAX_SEQ}`,
    row.id,
  );
  const channels = db.all<{ resource_kind: string; path: string }>(
    "SELECT DISTINCT resource_kind, path FROM events WHERE session_id = ? AND resource_kind IN ('robots','sitemap','feed','manifest','api','index')",
    row.id,
  );
  const lastPage = db.get<{ page_id: string; ts: number }>(
    "SELECT page_id, ts FROM events WHERE session_id = ? AND page_id IS NOT NULL AND status < 400 AND resource_kind IN ('page','special','alt','attachment','redirect') ORDER BY ts DESC LIMIT 1",
    row.id,
  );
  // an expiry that raced a restart: the visitor is back inside the window, so it is open again
  if (row.ended_at !== null) db.run('UPDATE sessions SET ended_at = NULL WHERE id = ?', row.id);

  let cohorts: Record<string, string> = {};
  if (row.cohorts_json) {
    try {
      cohorts = JSON.parse(row.cohorts_json) as Record<string, string>;
    } catch {
      cohorts = {};
    }
  }
  const channelsFetched = new Set<string>();
  // the archive sitemap is the stale_index channel; every other channel is named after its resource kind
  for (const c of channels) channelsFetched.add(c.resource_kind === 'sitemap' && c.path.includes('archive') ? 'stale_index' : c.resource_kind);
  const pageOrder = pageRows.map((p) => p.page_id);

  return {
    id: row.id,
    actorHash: row.actor_hash,
    kind: row.kind === 'cookie' ? 'cookie' : 'fingerprint',
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    ipTrunc: row.ip_trunc,
    ipHash: row.ip_hash,
    ua: row.ua,
    uaHash: row.ua_hash,
    uaFamily: row.ua_family ?? 'none',
    cookieReturned: Boolean(row.cookie_returned),
    nRequests: row.n_requests,
    nPages: row.n_pages,
    nErrors: row.n_errors,
    nHead: row.n_head,
    nPost: row.n_post,
    nDisallowed: row.n_disallowed,
    nSubresources: row.n_subresources,
    nMachine: row.n_machine,
    maxDepth: row.max_depth,
    firstPath: row.first_path,
    lastPath: row.last_path,
    firstRefererHost: row.first_referer_host,
    pages: new Set(pageOrder),
    pageOrder,
    seq: head.map((e) => e.page_id ?? `${e.resource_kind}:${e.path.slice(0, 80)}`),
    timestamps: head.map((e) => e.ts),
    channelsFetched,
    exposed: new Set(exposed.map((e) => e.canary_id)),
    synthetic: Boolean(row.synthetic),
    syntheticRun: row.synthetic_run,
    syntheticPersona: row.synthetic_persona,
    cohorts,
    dirty: false,
    persisted: true,
    lastPageId: lastPage?.page_id ?? null,
    lastPageAt: lastPage?.ts ?? 0,
  };
}
