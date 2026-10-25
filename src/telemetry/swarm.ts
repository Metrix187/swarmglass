import type { Db } from '../db/db.ts';
import { median } from '../util/time.ts';
import { shortHash } from '../util/hash.ts';
import type { ClusterResult, Signal } from './cluster.ts';
import { familyCategory } from './ua.ts';
import { channelPage, findHandoffs, type Discovery, type Fetch, type Handoff, type LinkGraph } from './handoff.ts';

// a swarm, for our purposes: one client spread across many network prefixes, most of them making a request or
// two and none of them rendering anything. pairwise clustering never sees it, two one-request sessions have
// nothing in common but the client, so this groups over a longer window instead. found by hand on 2026-09-06:
// 96 sessions, 86 prefixes, one six-year-old iphone string, six new addresses an hour all day (docs/findings/F-001).
//
// two things say "one client". the exact user-agent string, which the first swarm kept for a month. and the
// client stack's signature (capture.ts: header names in wire order minus the per-request and proxy ones), which a
// pool that rotates its string cannot rotate without changing the library underneath. the second pass groups by
// that, for sessions the first pass did not claim, and only when the strings disagree about what the client is.

export interface SwarmSession {
  id: string;
  actor_hash?: string;
  started_at: number;
  last_seen_at: number;
  ip_trunc: string | null;
  ua_hash: string | null;
  ua_family: string | null;
  ua: string | null;
  stack_hash?: string | null; // the session's dominant client-stack signature
  n_requests: number;
  n_subresources: number;
  n_conditional: number; // requests carrying If-None-Match / If-Modified-Since
  synthetic: boolean;
  pages: Set<string>;
}

export interface SwarmSummary {
  ua_family: string;
  ua_sample: string;
  sessions: number;
  requests: number;
  prefixes: number;
  prefixes16: number;
  single_hit_share: number;
  few_hits_share: number;
  requests_per_session_median: number;
  asset_share: number;
  conditional_share: number;
  pages: number;
  first_seen: number;
  last_seen: number;
  median_start_gap_ms: number;
  by: 'ua' | 'stack'; // what the members have in common
  tier: 'strict' | 'loose'; // one or two requests per address, or a few
  ua_strings: number;
  families: string[];
  stack: string | null;
  cadence_ms: number | null; // the period between new addresses when there is one
  cadence_share: number | null; // how many gaps sit within a quarter of it
  profile?: Record<string, unknown>; // what the pool sends and takes; filled by the clustering job
  handoffs?: Record<string, unknown>; // urls passed between members; filled by the clustering job
}

export type Swarm = ClusterResult & { summary: SwarmSummary };

export const SWARM_MIN_SESSIONS = 12;
export const SWARM_MIN_PREFIXES = 8;
// how many /16-ish blocks counts as "scattered everywhere" on its own. amazonbot sat at 173 the day this
// went in, SW-E6F2B0 at 31, and a nat big enough to reach this would be several ISPs in a trenchcoat
export const SWARM_WIDE_BLOCKS = 24;

// "43.130.67.0/24" -> "43.130"; "2a02:1234:5678::/48" -> "2a02:1234". coarse on purpose, it only counts
export function widePrefix(p: string): string {
  if (p.includes(':')) return p.split(':').slice(0, 2).join(':');
  return p.split('.').slice(0, 2).join('.');
}

export function detectSwarms(sessions: SwarmSession[]): Swarm[] {
  const out: Swarm[] = [];
  const taken = new Set<string>();
  // pass 1: one exact user-agent string
  for (const members of groupBy(sessions, (s) => (s.ua_hash ? `${s.synthetic ? 'syn' : 'real'}:${s.ua_hash}` : null)).values()) {
    const sw = judge(members, 'ua');
    if (!sw) continue;
    out.push(sw);
    for (const m of members) taken.add(m.id);
  }
  // pass 2: one http stack behind several browser strings. a mask is a browser costume on a library's stack, so
  // only sessions that claim to be a browser are grouped here; declared crawlers and bare libraries sharing a
  // stack are what they say they are. many copies of one browser share a stack too and are not a pool, so the
  // strings have to disagree: two browser families on one stack, or three or more browser strings on one stack
  const costumed = sessions.filter((s) => !taken.has(s.id) && familyCategory(s.ua_family) === 'browser');
  for (const members of groupBy(costumed, (s) => (s.stack_hash ? `${s.synthetic ? 'syn' : 'real'}:${s.stack_hash}` : null)).values()) {
    if (!masked(members)) continue;
    const sw = judge(members, 'stack');
    if (sw) out.push(sw);
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

function groupBy(sessions: SwarmSession[], key: (s: SwarmSession) => string | null): Map<string, SwarmSession[]> {
  const groups = new Map<string, SwarmSession[]>();
  for (const s of sessions) {
    const k = key(s);
    if (!k) continue;
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  return groups;
}

export function masked(members: SwarmSession[]): boolean {
  const browsers = members.filter((m) => familyCategory(m.ua_family) === 'browser');
  const families = new Set(browsers.map((m) => m.ua_family ?? 'none'));
  const strings = new Set(browsers.map((m) => m.ua_hash ?? 'none'));
  return families.size >= 2 || strings.size >= 3;
}

function judge(members: SwarmSession[], by: 'ua' | 'stack'): Swarm | null {
  if (members.length < SWARM_MIN_SESSIONS) return null;
  const prefixes = new Set(members.map((m) => m.ip_trunc).filter((p): p is string => Boolean(p)));
  if (prefixes.size < SWARM_MIN_PREFIXES) return null;
  const prefixes16 = new Set([...prefixes].map(widePrefix)).size;
  // a pool, not a couple of nats: most sessions have to come from somewhere new. a fleet that grows its
  // traffic faster than it rents addresses fails that even while obviously being a fleet, which is how
  // amazonbot dropped off the radar at 1620 sessions over 419 prefixes. so let a pool that is scattered
  // wide enough in on the spread alone, and keep the ratio for everyone below that
  if (prefixes.size / members.length < 0.5 && prefixes16 < SWARM_WIDE_BLOCKS) return null;
  const single = members.filter((m) => m.n_requests <= 2).length / members.length;
  const few = members.filter((m) => m.n_requests <= 4).length / members.length;
  const perSession = median(members.map((m) => m.n_requests));
  // strict is the shape the first swarm had. loose is a pool that reads a page and an alternate, or follows one
  // link, per address; it exists so that pool is not invisible, and it scores lower on purpose
  const tier: 'strict' | 'loose' | null = single >= 0.6 ? 'strict' : few >= 0.6 && perSession <= 4 ? 'loose' : null;
  if (!tier) return null;
  const requests = members.reduce((a, m) => a + m.n_requests, 0);
  const assets = members.reduce((a, m) => a + m.n_subresources, 0);
  const assetShare = requests ? assets / requests : 0;
  const conditional = members.reduce((a, m) => a + m.n_conditional, 0);
  // real phones fetch the stylesheet. this is the line between "many people once" and "one thing, many masks"
  if (assetShare > 0.05) return null;

  const starts = members.map((m) => m.started_at).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i++) gaps.push((starts[i] as number) - (starts[i - 1] as number));
  const first = starts[0] as number;
  const last = Math.max(...members.map((m) => m.last_seen_at));
  const union = new Set<string>();
  let touched = 0;
  for (const m of members) {
    for (const p of m.pages) {
      union.add(p);
      touched++;
    }
  }
  const lead = members[0] as SwarmSession;
  const strings = new Set(members.map((m) => m.ua_hash ?? 'none'));
  const families = [...new Set(members.map((m) => m.ua_family ?? 'none'))].sort();
  const stackCounts = new Map<string, number>();
  for (const m of members) if (m.stack_hash) stackCounts.set(m.stack_hash, (stackCounts.get(m.stack_hash) ?? 0) + 1);
  const stack = [...stackCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const signals: Signal[] = [
    {
      signal: 'many_prefixes_one_client',
      strength: Math.min(1, prefixes.size / 24),
      note: by === 'ua' ? `${prefixes.size} network prefixes across ${prefixes16} wider blocks share one exact user-agent` : `${prefixes.size} network prefixes across ${prefixes16} wider blocks share one http stack (header order) behind ${strings.size} user-agent strings`,
    },
    tier === 'strict'
      ? { signal: 'one_hit_per_address', strength: single, note: `${Math.round(single * 100)}% of sessions made one or two requests` }
      : { signal: 'few_hits_per_address', strength: Math.round(few * 70) / 100, note: `${Math.round(few * 100)}% of sessions made four requests or fewer, ${perSession} at the median` },
    { signal: 'never_rendered', strength: 1 - assetShare / 0.05, note: assets ? `${assets} asset fetches in ${requests} requests` : 'no member ever fetched a stylesheet, script or favicon' },
  ];
  if (by === 'stack') signals.push({ signal: 'masks', strength: Math.min(1, strings.size / 6), note: `${strings.size} user-agent strings (${families.join(', ')}) on one http stack: one client wearing masks` });
  const spanH = (last - first) / 3_600_000;
  if (members.length >= 20 && spanH >= 3) signals.push({ signal: 'sustained_trickle', strength: Math.min(1, spanH / 24), note: `spread over ${spanH.toFixed(1)}h, a new address every ${fmtGap(median(gaps))} at the median` });
  // a scheduler hands out addresses on a beat; a crowd does not
  let cadenceMs: number | null = null;
  let cadenceShare: number | null = null;
  if (gaps.length >= 20) {
    const med = median(gaps);
    const within = gaps.filter((g) => g >= med * 0.75 && g <= med * 1.25).length / gaps.length;
    cadenceMs = med;
    cadenceShare = Math.round(within * 100) / 100;
    if (within >= 0.5 && med > 0) signals.push({ signal: 'metronomic_pool', strength: Math.round(within * 100) / 100, note: `a new address every ${fmtGap(med)} give or take a quarter, ${Math.round(within * 100)}% of the time: a scheduler, not a crowd` });
  }
  if (union.size >= 12 && touched > 0 && union.size / touched > 0.7) signals.push({ signal: 'partitioned_coverage', strength: Math.min(1, union.size / 40), note: `${members.length} sessions touched ${union.size} pages with almost no overlap: the site divided up one page per address` });

  const raw = signals.reduce((a, s) => a + s.strength, 0);
  const synthetic = members.every((m) => m.synthetic);
  const day = Math.floor(first / 86_400_000);
  // stable across runs so links in notes keep working: same client, same first day, same id. the string pass
  // keeps the id it has had since 2026-09-06
  const key = by === 'ua' ? `${synthetic ? 'syn' : 'real'}:${lead.ua_hash}:${day}` : `${synthetic ? 'syn' : 'real'}:stack:${stack}:${day}`;
  const label =
    by === 'ua'
      ? tier === 'strict'
        ? 'distributed swarm: one client signature, one hit per address'
        : 'distributed pool: one client signature, a few requests per address'
      : `masked pool: one http stack behind ${strings.size} user-agent strings, ${tier === 'strict' ? 'one hit' : 'a few requests'} per address`;
  return {
    id: 'SW-' + shortHash(key, 6).toUpperCase(),
    members: members.map((m) => m.id),
    window_start: first,
    window_end: last,
    signals,
    swarm_score: Math.round(Math.min(1, raw / 3) * 1000) / 1000,
    label,
    synthetic,
    summary: {
      ua_family: lead.ua_family ?? 'none',
      ua_sample: (lead.ua ?? '').slice(0, 160),
      sessions: members.length,
      requests,
      prefixes: prefixes.size,
      prefixes16,
      single_hit_share: Math.round(single * 100) / 100,
      few_hits_share: Math.round(few * 100) / 100,
      requests_per_session_median: perSession,
      asset_share: Math.round(assetShare * 1000) / 1000,
      conditional_share: requests ? Math.round((conditional / requests) * 1000) / 1000 : 0,
      pages: union.size,
      first_seen: first,
      last_seen: last,
      median_start_gap_ms: gaps.length ? median(gaps) : 0,
      by,
      tier,
      ua_strings: strings.size,
      families,
      stack,
      cadence_ms: cadenceMs,
      cadence_share: cadenceShare,
    },
  };
}

function fmtGap(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)}min` : `${Math.round(ms / 1000)}s`;
}

export function loadSwarmSessions(db: Db, sinceMs: number, limit = 6000): SwarmSession[] {
  const rows = db.all<{ id: string; actor_hash: string; started_at: number; last_seen_at: number; ip_trunc: string | null; ua_hash: string | null; ua_family: string | null; ua: string | null; n_requests: number; n_subresources: number; synthetic: number }>(
    'SELECT id, actor_hash, started_at, last_seen_at, ip_trunc, ua_hash, ua_family, ua, n_requests, n_subresources, synthetic FROM sessions WHERE started_at >= ? AND ua_hash IS NOT NULL ORDER BY started_at DESC LIMIT ?',
    sinceMs,
    limit,
  );
  // one query for every session's pages instead of one per session; this runs every five minutes
  const pages = new Map<string, Set<string>>();
  for (const p of db.all<{ session_id: string; page_id: string }>('SELECT session_id, page_id FROM page_discoveries WHERE ts >= ?', sinceMs)) {
    const set = pages.get(p.session_id);
    if (set) set.add(p.page_id);
    else pages.set(p.session_id, new Set([p.page_id]));
  }
  const cond = new Map<string, number>();
  for (const c of db.all<{ session_id: string; n: number }>("SELECT session_id, COUNT(*) AS n FROM events WHERE ts >= ? AND (header_names LIKE '%if-none-match%' OR header_names LIKE '%if-modified-since%') GROUP BY session_id", sinceMs)) cond.set(c.session_id, c.n);
  // the session's dominant stack signature; a session has one unless the client rotated libraries mid-way
  const stack = new Map<string, { hash: string; n: number }>();
  for (const s of db.all<{ session_id: string; stack_hash: string; n: number }>('SELECT session_id, stack_hash, COUNT(*) AS n FROM events WHERE ts >= ? AND stack_hash IS NOT NULL GROUP BY session_id, stack_hash', sinceMs)) {
    const cur = stack.get(s.session_id);
    if (!cur || s.n > cur.n) stack.set(s.session_id, { hash: s.stack_hash, n: s.n });
  }
  return rows.map((r) => ({ ...r, synthetic: Boolean(r.synthetic), n_conditional: cond.get(r.id) ?? 0, pages: pages.get(r.id) ?? new Set<string>(), stack_hash: stack.get(r.id)?.hash ?? null }));
}

// ---- what a pool sends and what it takes, over every member request. bounded lists, stored in the cluster's
// summary so the console never re-derives it ----

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

type Count = { k: string | null; n: number };

export function swarmProfile(db: Db, ids: string[]): Record<string, unknown> {
  const all = <T>(sql: string, ...args: unknown[]): T[] => {
    const out: T[] = [];
    for (const chunk of chunks(ids, 400)) out.push(...db.all<T>(sql.replace('{ids}', chunk.map(() => '?').join(',')), ...chunk, ...args));
    return out;
  };
  const top = (rows: Count[], n = 6): Record<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.k === null || r.k === '' ? 'none' : String(r.k);
      m.set(k, (m.get(k) ?? 0) + r.n);
    }
    return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n));
  };
  const by = (expr: string, extra = '') => all<Count>(`SELECT ${expr} AS k, COUNT(*) AS n FROM events WHERE session_id IN ({ids})${extra} GROUP BY k`);
  const total = all<{ n: number; cookie: number; pragma: number; conditional: number; lang: number; referer_int: number; referer_ext: number; head: number }>(
    "SELECT COUNT(*) AS n, SUM(cookie_present) AS cookie, SUM(CASE WHEN (',' || header_names || ',') LIKE '%,pragma,%' THEN 1 ELSE 0 END) AS pragma, SUM(CASE WHEN header_names LIKE '%if-none-match%' OR header_names LIKE '%if-modified-since%' THEN 1 ELSE 0 END) AS conditional, SUM(CASE WHEN accept_lang IS NOT NULL THEN 1 ELSE 0 END) AS lang, SUM(CASE WHEN referer IS NOT NULL AND referer_internal = 1 THEN 1 ELSE 0 END) AS referer_int, SUM(CASE WHEN referer IS NOT NULL AND referer_internal = 0 THEN 1 ELSE 0 END) AS referer_ext, SUM(CASE WHEN method = 'HEAD' THEN 1 ELSE 0 END) AS head FROM events WHERE session_id IN ({ids})",
  ).reduce((a, r) => ({ n: a.n + r.n, cookie: a.cookie + (r.cookie ?? 0), pragma: a.pragma + (r.pragma ?? 0), conditional: a.conditional + (r.conditional ?? 0), lang: a.lang + (r.lang ?? 0), referer_int: a.referer_int + (r.referer_int ?? 0), referer_ext: a.referer_ext + (r.referer_ext ?? 0), head: a.head + (r.head ?? 0) }), { n: 0, cookie: 0, pragma: 0, conditional: 0, lang: 0, referer_int: 0, referer_ext: 0, head: 0 });
  const share = (x: number) => (total.n ? Math.round((x / total.n) * 1000) / 1000 : 0);
  const stacks = all<{ k: string | null; names: string | null; n: number }>('SELECT stack_hash AS k, MIN(header_names) AS names, COUNT(*) AS n FROM events WHERE session_id IN ({ids}) GROUP BY stack_hash');
  const stackMap = new Map<string, { names: string; n: number }>();
  for (const s of stacks) {
    const k = s.k ?? 'none';
    const cur = stackMap.get(k);
    if (cur) cur.n += s.n;
    else stackMap.set(k, { names: s.names ?? '', n: s.n });
  }
  const exposed = all<{ n: number }>('SELECT COUNT(DISTINCT canary_id) AS n FROM canary_exposures WHERE session_id IN ({ids})').reduce((a, r) => a + r.n, 0);
  const seen = all<{ n: number; xa: number }>('SELECT COUNT(*) AS n, SUM(cross_actor) AS xa FROM canary_sightings WHERE session_id IN ({ids})').reduce((a, r) => ({ n: a.n + r.n, xa: a.xa + (r.xa ?? 0) }), { n: 0, xa: 0 });
  return {
    requests: total.n,
    methods: top(by('method')),
    http_versions: top(by('http_version')),
    tls: top(by("json_extract(extra_json, '$.tls')"), 4),
    accept_profiles: top(by("json_extract(extra_json, '$.accept_profile')")),
    accept_encodings: top(by('accept_enc'), 4),
    accept_languages: top(by('accept_lang'), 4),
    kinds: top(by('resource_kind'), 10),
    statuses: top(by('(status / 100) * 100')),
    negotiated: top(by('negotiated')),
    query_keys: top(all<Count>("SELECT je.key AS k, COUNT(*) AS n FROM events e, json_each(e.query_json) je WHERE e.session_id IN ({ids}) AND e.query_json IS NOT NULL GROUP BY k"), 8),
    stacks: [...stackMap.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([stack, v]) => ({ stack, names: v.names.split(',').filter(Boolean), requests: v.n })),
    shares: { cookie: share(total.cookie), pragma: share(total.pragma), conditional: share(total.conditional), accept_language: share(total.lang), referer_internal: share(total.referer_int), referer_external: share(total.referer_ext), head: share(total.head) },
    canaries: { exposed, presented: seen.n, cross_actor: seen.xa },
  };
}

// urls passed between members: a member reaches a page it was never shown, right after another member was shown
// a page that links there. the shared-queue signature, measured on every page in the seed's link graph
export function swarmHandoffs(db: Db, ids: string[], graph: LinkGraph): Record<string, unknown> {
  const all = <T>(sql: string): T[] => {
    const out: T[] = [];
    for (const chunk of chunks(ids, 400)) out.push(...db.all<T>(sql.replace('{ids}', chunk.map(() => '?').join(',')), ...chunk));
    return out;
  };
  const discoveries = all<Discovery & { page_id: string; actor_hash: string; session_id: string }>('SELECT pd.session_id, pd.page_id, pd.ts, pd.via, s.actor_hash FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.session_id IN ({ids})').map((r) => ({ session: r.session_id, actor: r.actor_hash, page: r.page_id, ts: r.ts, via: r.via }));
  // page renders and channel fetches alike: a member that read the sitemap was told every listed url
  const fetches = all<{ ts: number; page_id: string | null; resource_kind: string; path: string; session_id: string; actor_hash: string }>("SELECT e.ts, e.page_id, e.resource_kind, e.path, e.session_id, s.actor_hash FROM events e JOIN sessions s ON s.id = e.session_id WHERE e.session_id IN ({ids}) AND e.status < 400 AND (e.page_id IS NOT NULL AND e.resource_kind IN ('page', 'alt', 'attachment') OR e.resource_kind IN ('robots', 'sitemap', 'feed', 'manifest', 'api', 'index'))")
    .map((r): (Fetch & { page: string }) | null => {
      const page = r.page_id && ['page', 'alt', 'attachment'].includes(r.resource_kind) ? r.page_id : channelPage(r.resource_kind, r.path);
      return page ? { ts: r.ts, actor: r.actor_hash, session: r.session_id, page } : null;
    })
    .filter((x): x is Fetch & { page: string } => x !== null);
  const actors = new Set(fetches.map((f) => f.actor));
  const r = findHandoffs(graph, discoveries, fetches, { sources: actors, maxHandoffs: 20 });
  const sample: Handoff[] = r.handoffs;
  return { considered: r.considered, explained: r.explained, handoffs: r.handoffs.length + 0 === r.handoffs.length ? countHandoffs(r) : 0, unsourced: r.unsourced, share: r.share, median_lag_ms: r.median_lag_ms, top_pages: r.top_pages, sample };
}

// findHandoffs trims its list to maxHandoffs; the count comes from the share it computed over the full set
function countHandoffs(r: { considered: number; share: number }): number {
  return Math.round(r.share * r.considered);
}
