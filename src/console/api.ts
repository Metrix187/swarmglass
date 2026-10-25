import type { Db } from '../db/db.ts';
import { resolveAlias, type Catalog } from '../wiki/content.ts';
import type { ExperimentRegistry } from '../experiments/registry.ts';
import type { EventRow, Features } from '../telemetry/features.ts';
import type { Scores } from '../telemetry/scoring.ts';
import { buildStory } from './story.ts';
import { ngrams } from '../util/text.ts';
import { dayKey, median, percentile } from '../util/time.ts';
import { compareExperiment, type Comparison } from '../experiments/compare.ts';
import { isScannerPath } from '../http/security.ts';
import { buildLinkGraph, channelPage, findHandoffs, handoffComponents, type Discovery, type Fetch } from '../telemetry/handoff.ts';
import { UA_RULES, familyCategory } from '../telemetry/ua.ts';

// read-side queries for the research console. everything returns plain json-able objects.
// `synthetic` is always an explicit filter so test traffic never sneaks into a real chart.

export interface QueryDeps {
  db: Db;
  cat: Catalog;
  registry: ExperimentRegistry;
}

export interface Range {
  since: number;
  until: number;
}

export function parseRange(s: string | null): Range {
  const until = Date.now();
  const m = (s ?? '24h').match(/^(\d+)([hdm])$/);
  const n = m ? Number(m[1]) : 24;
  const unit = m ? m[2] : 'h';
  const ms = unit === 'm' ? 60_000 : unit === 'd' ? 86_400_000 : 3_600_000;
  return { since: until - n * ms, until };
}

function synthFilter(synthetic: 'real' | 'synthetic' | 'all'): { sql: string; args: unknown[] } {
  if (synthetic === 'all') return { sql: '', args: [] };
  return { sql: ' AND synthetic = ?', args: [synthetic === 'synthetic' ? 1 : 0] };
}

export function overview(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Record<string, unknown> {
  const { db } = d;
  const sf = synthFilter(synthetic);
  const totals = db.get<{ requests: number; sessions: number; errors: number; sightings: number }>(
    `SELECT (SELECT COUNT(*) FROM events WHERE ts >= ? AND ts <= ?${sf.sql}) AS requests,
            (SELECT COUNT(*) FROM sessions WHERE started_at >= ? AND started_at <= ?${sf.sql}) AS sessions,
            (SELECT COUNT(*) FROM events WHERE ts >= ? AND ts <= ? AND status >= 400${sf.sql}) AS errors,
            (SELECT COUNT(*) FROM canary_sightings WHERE ts >= ? AND ts <= ?${sf.sql}) AS sightings`,
    range.since, range.until, ...sf.args, range.since, range.until, ...sf.args, range.since, range.until, ...sf.args, range.since, range.until, ...sf.args,
  );
  const bucketMs = Math.max(60_000, Math.floor((range.until - range.since) / 96));
  const series = db.all<{ b: number; n: number; err: number }>(
    `SELECT (ts / ?) * ? AS b, COUNT(*) AS n, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS err FROM events WHERE ts >= ? AND ts <= ?${sf.sql} GROUP BY b ORDER BY b`,
    bucketMs, bucketMs, range.since, range.until, ...sf.args,
  );
  const classes = db.all<{ c: string | null; n: number; conf: number | null }>(`SELECT likely_class AS c, COUNT(*) AS n, AVG(class_confidence) AS conf FROM sessions WHERE started_at >= ? AND started_at <= ?${sf.sql} GROUP BY likely_class ORDER BY n DESC`, range.since, range.until, ...sf.args);
  const families = db.all<{ f: string | null; n: number }>(`SELECT ua_family AS f, COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at <= ?${sf.sql} GROUP BY ua_family ORDER BY n DESC LIMIT 12`, range.since, range.until, ...sf.args);
  const kinds = db.all<{ k: string; n: number }>(`SELECT resource_kind AS k, COUNT(*) AS n FROM events WHERE ts >= ? AND ts <= ?${sf.sql} GROUP BY resource_kind ORDER BY n DESC`, range.since, range.until, ...sf.args);
  const topPages = db.all<{ p: string; n: number; s: number }>(`SELECT page_id AS p, COUNT(*) AS n, COUNT(DISTINCT session_id) AS s FROM events WHERE ts >= ? AND ts <= ? AND page_id IS NOT NULL AND status < 400${sf.sql} GROUP BY page_id ORDER BY s DESC, n DESC LIMIT 15`, range.since, range.until, ...sf.args);
  const discovery = db.all<{ v: string; n: number }>(`SELECT CASE WHEN via LIKE 'referer:%' THEN 'referer' WHEN via LIKE 'channel:%' THEN via WHEN via LIKE 'sequence:%' THEN 'sequence' WHEN via LIKE 'unknown:%' THEN 'unknown' ELSE via END AS v, COUNT(*) AS n FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.ts >= ? AND pd.ts <= ?${sf.sql.replace('synthetic', 's.synthetic')} GROUP BY v ORDER BY n DESC`, range.since, range.until, ...sf.args);
  const sightings = db.all<{ ts: number; canary_id: string; session_id: string | null; seen_in: string; cross_session: number; cross_actor: number; external: number }>(`SELECT ts, canary_id, session_id, seen_in, cross_session, cross_actor, external FROM canary_sightings WHERE ts >= ? AND ts <= ?${sf.sql} ORDER BY ts DESC LIMIT 12`, range.since, range.until, ...sf.args);
  const disk = db.get<{ v: string }>("SELECT v FROM kv WHERE k = 'disk_guard'");
  const hidden = db.get<{ n: number }>(`SELECT COUNT(DISTINCT session_id) AS n FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.ts >= ? AND pd.ts <= ? AND pd.discover_class IS NOT NULL AND pd.discover_class != 'visible'${sf.sql.replace('synthetic', 's.synthetic')}`, range.since, range.until, ...sf.args);
  const cross = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM canary_sightings WHERE ts >= ? AND ts <= ? AND cross_session = 1${sf.sql}`, range.since, range.until, ...sf.args);
  return {
    range,
    synthetic,
    totals: { ...(totals ?? { requests: 0, sessions: 0, errors: 0, sightings: 0 }), sessions_reaching_hidden: hidden?.n ?? 0, cross_session_sightings: cross?.n ?? 0 },
    series: series.map((r) => ({ t: r.b, n: r.n, err: r.err })),
    bucket_ms: bucketMs,
    classes: classes.map((r) => ({ class: r.c ?? 'unscored', n: r.n, mean_confidence: r.conf })),
    families: families.map((r) => ({ family: r.f ?? 'none', n: r.n })),
    kinds: kinds.map((r) => ({ kind: r.k, n: r.n })),
    top_pages: topPages.map((r) => ({ page: r.p, requests: r.n, sessions: r.s, discover: d.cat.pages.get(r.p)?.discover ?? null })),
    discovery: discovery.map((r) => ({ via: r.v, n: r.n })),
    recent_sightings: sightings,
    experiments: d.registry.active().map((e) => ({ id: e.id, name: e.name, variable: e.variable, arms: e.arms.length })),
    disk: disk ? JSON.parse(disk.v) : null,
    activity: activityGrid(db, `ts >= ? AND ts <= ?${sf.sql}`, [range.since, range.until, ...sf.args]),
  };
}

export interface SessionListOpts {
  range: Range;
  synthetic: 'real' | 'synthetic' | 'all';
  cls?: string | null;
  family?: string | null;
  q?: string | null;
  cluster?: string | null;
  experiment?: string | null;
  arm?: string | null;
  signature?: string | null; // header-order hash, see signatures()
  minRequests?: number;
  limit: number;
  offset: number;
  sort: 'recent' | 'requests' | 'pages' | 'confidence' | 'hidden';
}

export function listSessions(d: QueryDeps, o: SessionListOpts): { total: number; rows: Record<string, unknown>[] } {
  const where: string[] = ['started_at >= ?', 'started_at <= ?'];
  const args: unknown[] = [o.range.since, o.range.until];
  if (o.synthetic !== 'all') {
    where.push('synthetic = ?');
    args.push(o.synthetic === 'synthetic' ? 1 : 0);
  }
  if (o.cls) {
    where.push('likely_class = ?');
    args.push(o.cls);
  }
  if (o.family) {
    where.push('ua_family = ?');
    args.push(o.family);
  }
  if (o.cluster) {
    where.push('cluster_id = ?');
    args.push(o.cluster);
  }
  if (o.experiment) {
    where.push("cohorts_json LIKE ?");
    args.push(`%"${o.experiment}":"${o.arm ?? ''}%`);
  }
  if (o.signature) {
    where.push('id IN (SELECT DISTINCT session_id FROM events WHERE stack_hash = ?)');
    args.push(o.signature);
  }
  if (o.minRequests) {
    where.push('n_requests >= ?');
    args.push(o.minRequests);
  }
  if (o.q) {
    where.push('(id LIKE ? OR ua LIKE ? OR first_path LIKE ? OR actor_hash LIKE ?)');
    const like = `%${o.q.replace(/[%_]/g, '')}%`;
    args.push(like, like, like, like);
  }
  const order = { recent: 'last_seen_at DESC', requests: 'n_requests DESC', pages: 'n_unique_pages DESC', confidence: 'class_confidence DESC', hidden: 'n_machine DESC' }[o.sort];
  const total = d.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE ${where.join(' AND ')}`, ...args)?.n ?? 0;
  const rows = d.db.all<Record<string, unknown>>(
    `SELECT id, actor_hash, kind, started_at, last_seen_at, ended_at, ip_trunc, ua, ua_family, cookie_returned, n_requests, n_pages, n_unique_pages, n_errors, n_head, n_post, n_disallowed, n_subresources, n_machine, max_depth, first_path, last_path, first_referer_host, synthetic, synthetic_run, synthetic_persona, cohorts_json, likely_class, class_confidence, cluster_id, scored_at FROM sessions WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...args,
    o.limit,
    o.offset,
  );
  return { total, rows: rows.map(decodeSessionRow) };
}

function decodeSessionRow(r: Record<string, unknown>): Record<string, unknown> {
  const out = { ...r };
  for (const k of ['cohorts_json', 'features_json', 'scores_json']) {
    if (typeof out[k] === 'string') {
      try {
        out[k.replace('_json', '')] = JSON.parse(out[k] as string);
      } catch {
        out[k.replace('_json', '')] = null;
      }
      delete out[k];
    }
  }
  return out;
}

export function sessionDetail(d: QueryDeps, id: string): Record<string, unknown> | null {
  const { db } = d;
  const row = db.get<Record<string, unknown>>('SELECT * FROM sessions WHERE id = ?', id);
  if (!row) return null;
  const s = decodeSessionRow(row);
  const events = db.all<EventRow & { id: number; canaries_exposed: string | null }>('SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC LIMIT 2000', id);
  const discoveries = db.all('SELECT page_id, ts, via, discover_class, depth, order_no FROM page_discoveries WHERE session_id = ? ORDER BY order_no', id);
  const edges = db.all('SELECT from_page, to_page, ts, kind FROM nav_edges WHERE session_id = ? ORDER BY ts', id);
  const sightings = db.all('SELECT ts, canary_id, seen_in, path, detail, cross_session, cross_actor, exposure_session_id, delta_ms FROM canary_sightings WHERE session_id = ? ORDER BY ts', id);
  const exposures = db.all('SELECT canary_id, first_at, placement FROM canary_exposures WHERE session_id = ? ORDER BY first_at', id);
  const features = (s.features as Features | null) ?? null;
  const scores = (s.scores as Scores | null) ?? null;
  const story = buildStory(events, features, scores, { uaFamily: String(s.ua_family ?? 'none'), cookieReturned: Boolean(s.cookie_returned), synthetic: Boolean(s.synthetic), persona: (s.synthetic_persona as string | null) ?? null });
  const similar = similarSessions(d, id, String(s.actor_hash), Number(s.started_at));
  const gaps: number[] = [];
  for (let i = 1; i < events.length; i++) gaps.push((events[i] as EventRow).ts - (events[i - 1] as EventRow).ts);
  const gapHist = histogram(gaps, [50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000]);
  const otherSessionsOfActor = db.all<{ id: string; started_at: number; n_requests: number; likely_class: string | null }>('SELECT id, started_at, n_requests, likely_class FROM sessions WHERE actor_hash = ? AND id != ? ORDER BY started_at DESC LIMIT 20', String(s.actor_hash), id);
  return {
    session: s,
    events: events.map((e) => ({ ...e, malformed: e.malformed ? JSON.parse(e.malformed) : null, canaries_exposed: e.canaries_exposed ? JSON.parse(e.canaries_exposed) : null, canaries_seen: e.canaries_seen ? JSON.parse(e.canaries_seen) : null, query: e.query_json ? JSON.parse(e.query_json) : null, extra: e.extra_json ? JSON.parse(e.extra_json) : null })),
    discoveries,
    edges,
    sightings,
    exposures,
    story,
    similar,
    gap_histogram: gapHist,
    actor_sessions: otherSessionsOfActor,
    pages: discoveries.map((x) => {
      const p = d.cat.pages.get(String((x as { page_id: string }).page_id));
      return { id: (x as { page_id: string }).page_id, title: p?.title ?? null, discover: p?.discover ?? null, depth: p?.depth ?? null, categories: p?.categories ?? [] };
    }),
  };
}

function histogram(values: number[], edges: number[]): Array<{ label: string; n: number }> {
  const bins = edges.map((e, i) => ({ label: i === 0 ? `<${e}ms` : `${edges[i - 1]}–${e}ms`, n: 0 }));
  bins.push({ label: `>${edges[edges.length - 1]}ms`, n: 0 });
  for (const v of values) {
    let i = edges.findIndex((e) => v < e);
    if (i < 0) i = edges.length;
    (bins[i] as { n: number }).n++;
  }
  return bins;
}

export function similarSessions(d: QueryDeps, id: string, actorHash: string, startedAt: number): Array<Record<string, unknown>> {
  const { db } = d;
  const mine = new Set(db.all<{ page_id: string }>('SELECT page_id FROM page_discoveries WHERE session_id = ?', id).map((r) => r.page_id));
  if (!mine.size) return [];
  const window = 7 * 86_400_000;
  const candidates = db.all<{ id: string; actor_hash: string; started_at: number; likely_class: string | null; ua_family: string | null; n_unique_pages: number; synthetic: number }>(
    'SELECT id, actor_hash, started_at, likely_class, ua_family, n_unique_pages, synthetic FROM sessions WHERE id != ? AND started_at >= ? AND started_at <= ? AND n_unique_pages >= 2 ORDER BY started_at DESC LIMIT 400',
    id,
    startedAt - window,
    startedAt + window,
  );
  const out: Array<Record<string, unknown>> = [];
  for (const c of candidates) {
    const theirs = new Set(db.all<{ page_id: string }>('SELECT page_id FROM page_discoveries WHERE session_id = ?', c.id).map((r) => r.page_id));
    let inter = 0;
    for (const p of mine) if (theirs.has(p)) inter++;
    const j = inter / (mine.size + theirs.size - inter);
    if (j >= 0.3) out.push({ id: c.id, jaccard: Math.round(j * 100) / 100, same_actor: c.actor_hash === actorHash, likely_class: c.likely_class, ua_family: c.ua_family, started_at: c.started_at, synthetic: Boolean(c.synthetic) });
  }
  return out.sort((a, b) => (b.jaccard as number) - (a.jaccard as number)).slice(0, 15);
}

export function listClusters(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Array<Record<string, unknown>> {
  const sf = synthFilter(synthetic);
  const rows = d.db.all<{ id: string; created_at: number; window_start: number; window_end: number; size: number; signals_json: string; swarm_score: number; label: string; synthetic: number; kind: string; summary_json: string | null }>(
    `SELECT * FROM clusters WHERE window_end >= ?${sf.sql} ORDER BY (kind = 'swarm') DESC, swarm_score DESC, size DESC LIMIT 100`,
    range.since,
    ...sf.args,
  );
  return rows.map((r) => ({ ...r, signals: JSON.parse(r.signals_json), signals_json: undefined, summary: parseSummary(r.summary_json), summary_json: undefined, members: d.db.all<{ id: string; ua_family: string | null; likely_class: string | null; ip_trunc: string | null; n_unique_pages: number; started_at: number }>('SELECT id, ua_family, likely_class, ip_trunc, n_unique_pages, started_at FROM sessions WHERE cluster_id = ? ORDER BY started_at', r.id) }));
}

// swarm rows carry their shape as json; behavioural rows have none
function parseSummary(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function clusterDetail(d: QueryDeps, id: string): Record<string, unknown> | null {
  const r = d.db.get<{ id: string; created_at: number; window_start: number; window_end: number; size: number; signals_json: string; swarm_score: number; label: string; synthetic: number; kind: string; summary_json: string | null }>('SELECT * FROM clusters WHERE id = ?', id);
  if (!r) return null;
  const members = d.db.all<Record<string, unknown>>('SELECT id, actor_hash, ua_family, ua_hash, likely_class, class_confidence, ip_trunc, n_requests, n_unique_pages, started_at, last_seen_at, features_json FROM sessions WHERE cluster_id = ? ORDER BY started_at', id).map(decodeSessionRow);
  const pageMatrix: Record<string, string[]> = {};
  for (const m of members) {
    for (const p of d.db.all<{ page_id: string }>('SELECT page_id FROM page_discoveries WHERE session_id = ?', String(m.id))) {
      (pageMatrix[p.page_id] ??= []).push(String(m.id));
    }
  }
  const metrics = r.kind === 'swarm' ? swarmMetrics(d, id) : null;
  const activity = activityGrid(d.db, 'session_id IN (SELECT id FROM sessions WHERE cluster_id = ?)', [id]);
  const summary = parseSummary(r.summary_json);
  const related = r.kind === 'swarm' ? relatedSwarms(d, id, summary) : [];
  const pool = r.kind === 'swarm' ? poolGrowth(d, id) : null;
  return { ...r, signals: JSON.parse(r.signals_json), summary, summary_json: undefined, members, page_matrix: pageMatrix, metrics, activity, related, pool };
}

// other pools this one may be the same operator as: addresses in common, or the same http stack underneath
function relatedSwarms(d: QueryDeps, id: string, summary: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const others = d.db.all<{ id: string; label: string; size: number; summary_json: string | null; window_start: number; window_end: number }>("SELECT id, label, size, summary_json, window_start, window_end FROM clusters WHERE kind = 'swarm' AND id != ?", id);
  const out: Array<Record<string, unknown>> = [];
  for (const o of others) {
    const shared = d.db.get<{ n: number }>('SELECT COUNT(DISTINCT ip_trunc) AS n FROM sessions WHERE cluster_id = ? AND ip_trunc IN (SELECT ip_trunc FROM sessions WHERE cluster_id = ? AND ip_trunc IS NOT NULL)', o.id, id)?.n ?? 0;
    const os = parseSummary(o.summary_json);
    const sameStack = Boolean(summary?.stack && os?.stack && summary.stack === os.stack);
    const sameFamily = Boolean(summary?.ua_family && os?.ua_family === summary.ua_family);
    if (shared < 3 && !sameStack) continue;
    out.push({ id: o.id, label: o.label, size: o.size, shared_prefixes: shared, same_stack: sameStack, same_family: sameFamily, ua_family: os?.ua_family ?? null, window_start: o.window_start, window_end: o.window_end });
  }
  return out.sort((a, b) => (b.shared_prefixes as number) - (a.shared_prefixes as number));
}

// the pool over time: how many addresses it used each day, and how many of those it had never used before
function poolGrowth(d: QueryDeps, id: string): Array<Record<string, unknown>> {
  const rows = d.db.all<{ ip_trunc: string | null; started_at: number }>('SELECT ip_trunc, started_at FROM sessions WHERE cluster_id = ? ORDER BY started_at ASC', id);
  const seen = new Set<string>();
  const days = new Map<string, { day: string; sessions: number; prefixes: Set<string>; new_prefixes: number }>();
  for (const r of rows) {
    const p = r.ip_trunc ?? '?';
    const day = dayKey(r.started_at);
    const cell = days.get(day) ?? { day, sessions: 0, prefixes: new Set<string>(), new_prefixes: 0 };
    cell.sessions++;
    cell.prefixes.add(p);
    if (!seen.has(p)) {
      seen.add(p);
      cell.new_prefixes++;
    }
    days.set(day, cell);
  }
  return [...days.values()].map((c) => ({ day: c.day, sessions: c.sessions, prefixes: c.prefixes.size, new_prefixes: c.new_prefixes, returning_prefixes: c.prefixes.size - c.new_prefixes }));
}

// the three curves F-001 asked for: does the pool run out of new pages, which pages does it come back to and how
// often, and how long after it last saw a page linking to X does it fetch X
function swarmMetrics(d: QueryDeps, clusterId: string): Record<string, unknown> {
  const rows = d.db.all<{ ts: number; page_id: string }>('SELECT e.ts, e.page_id FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.cluster_id = ? AND e.page_id IS NOT NULL AND e.status < 400 ORDER BY e.ts ASC LIMIT 20000', clusterId);
  const seen = new Set<string>();
  const hours = new Map<number, { hour: number; requests: number; fresh: number }>();
  const fetches = new Map<string, number[]>();
  for (const r of rows) {
    const h = Math.floor(r.ts / 3_600_000) * 3_600_000;
    const cell = hours.get(h) ?? { hour: h, requests: 0, fresh: 0 };
    cell.requests++;
    if (!seen.has(r.page_id)) {
      seen.add(r.page_id);
      cell.fresh++;
    }
    hours.set(h, cell);
    const list = fetches.get(r.page_id);
    if (list) list.push(r.ts);
    else fetches.set(r.page_id, [r.ts]);
  }
  const revisits = [...fetches.entries()]
    .filter(([, ts]) => ts.length > 1)
    .map(([page, ts]) => {
      const gaps: number[] = [];
      for (let i = 1; i < ts.length; i++) gaps.push((ts[i] as number) - (ts[i - 1] as number));
      return { page, fetches: ts.length, median_gap_ms: median(gaps), last_ts: ts[ts.length - 1] };
    })
    .sort((a, b) => b.fetches - a.fetches)
    .slice(0, 40);
  // parents from the seed's link graph: pages whose visible prose links to X
  const parents = new Map<string, string[]>();
  for (const p of d.cat.pages.values()) {
    for (const l of p.links) {
      const id = resolveAlias(d.cat.pages, l) ?? l;
      const arr = parents.get(id);
      if (arr) arr.push(p.id);
      else parents.set(id, [p.id]);
    }
  }
  const lags: Array<{ page: string; lag_ms: number; parent: string }> = [];
  for (const [page, ts] of fetches) {
    const first = ts[0] as number;
    let best: { t: number; parent: string } | null = null;
    for (const parent of parents.get(page) ?? []) for (const t of fetches.get(parent) ?? []) if (t < first && (!best || t > best.t)) best = { t, parent };
    if (best) lags.push({ page, lag_ms: first - best.t, parent: best.parent });
  }
  lags.sort((a, b) => a.lag_ms - b.lag_ms);
  const ms = lags.map((l) => l.lag_ms);
  return {
    saturation: [...hours.values()].sort((a, b) => a.hour - b.hour),
    revisits,
    frontier: { n: lags.length, p25_ms: ms.length ? percentile(ms, 25) : null, median_ms: ms.length ? median(ms) : null, p75_ms: ms.length ? percentile(ms, 75) : null, samples: lags.slice(0, 20) },
  };
}

export function pageFunnel(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Array<Record<string, unknown>> {
  const sf = synthFilter(synthetic).sql.replace('synthetic', 's.synthetic');
  const args = synthFilter(synthetic).args;
  const reach = d.db.all<{ page_id: string; sessions: number; requests: number; first_ms: number | null }>(
    `SELECT pd.page_id, COUNT(DISTINCT pd.session_id) AS sessions, (SELECT COUNT(*) FROM events e WHERE e.page_id = pd.page_id AND e.ts >= ? AND e.ts <= ? AND e.status < 400) AS requests, AVG(pd.ts - s.started_at) AS first_ms FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.ts >= ? AND pd.ts <= ?${sf} GROUP BY pd.page_id`,
    range.since, range.until, range.since, range.until, ...args,
  );
  const byPage = new Map(reach.map((r) => [r.page_id, r]));
  const byClass = d.db.all<{ page_id: string; c: string | null; n: number }>(`SELECT pd.page_id, s.likely_class AS c, COUNT(DISTINCT pd.session_id) AS n FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.ts >= ? AND pd.ts <= ?${sf} GROUP BY pd.page_id, s.likely_class`, range.since, range.until, ...args);
  const classMap = new Map<string, Record<string, number>>();
  for (const r of byClass) {
    const m = classMap.get(r.page_id) ?? {};
    m[r.c ?? 'unscored'] = r.n;
    classMap.set(r.page_id, m);
  }
  const via = d.db.all<{ page_id: string; v: string; n: number }>(`SELECT pd.page_id, CASE WHEN via LIKE 'referer:%' THEN 'referer' WHEN via LIKE 'channel:%' THEN via WHEN via LIKE 'sequence:%' THEN 'sequence' WHEN via LIKE 'unknown:%' THEN 'unknown' ELSE via END AS v, COUNT(*) AS n FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.ts >= ? AND pd.ts <= ?${sf} GROUP BY pd.page_id, v`, range.since, range.until, ...args);
  const viaMap = new Map<string, Record<string, number>>();
  for (const r of via) {
    const m = viaMap.get(r.page_id) ?? {};
    m[r.v] = r.n;
    viaMap.set(r.page_id, m);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const p of d.cat.pages.values()) {
    const r = byPage.get(p.id);
    out.push({ id: p.id, title: p.title, kind: p.kind, discover: p.discover, depth: p.depth, channels: p.channels, experiment: p.experiment, sessions: r?.sessions ?? 0, requests: r?.requests ?? 0, mean_first_ms: r?.first_ms ?? null, by_class: classMap.get(p.id) ?? {}, via: viaMap.get(p.id) ?? {} });
  }
  for (const a of d.cat.attachments.values()) {
    const id = 'attachment:' + a.name;
    const r = byPage.get(id);
    out.push({ id, title: a.name, kind: 'attachment', discover: a.discover, depth: null, channels: a.channels, experiment: null, sessions: r?.sessions ?? 0, requests: r?.requests ?? 0, mean_first_ms: r?.first_ms ?? null, by_class: classMap.get(id) ?? {}, via: viaMap.get(id) ?? {} });
  }
  return out.sort((a, b) => (b.sessions as number) - (a.sessions as number));
}

export function discoveryMatrix(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Record<string, unknown> {
  const sf = synthFilter(synthetic).sql.replace('synthetic', 's.synthetic');
  const args = synthFilter(synthetic).args;
  const rows = d.db.all<{ cls: string | null; disc: string | null; n: number }>(`SELECT s.likely_class AS cls, pd.discover_class AS disc, COUNT(DISTINCT pd.session_id) AS n FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.ts >= ? AND pd.ts <= ?${sf} GROUP BY cls, disc`, range.since, range.until, ...args);
  const classTotals = d.db.all<{ cls: string | null; n: number }>(`SELECT likely_class AS cls, COUNT(*) AS n FROM sessions s WHERE started_at >= ? AND started_at <= ?${sf} GROUP BY cls`, range.since, range.until, ...args);
  const classes = [...new Set(rows.map((r) => r.cls ?? 'unscored'))].sort();
  const discs = [...new Set(rows.map((r) => r.disc ?? 'visible'))].sort();
  const cells: Record<string, Record<string, number>> = {};
  for (const r of rows) (cells[r.cls ?? 'unscored'] ??= {})[r.disc ?? 'visible'] = r.n;
  return { classes, discover_classes: discs, cells, class_totals: Object.fromEntries(classTotals.map((r) => [r.cls ?? 'unscored', r.n])) };
}

export function canaryReport(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Record<string, unknown> {
  const sf = synthFilter(synthetic);
  const byPlacement = d.db.all<{ placement: string; scope: string; issued: number; exposed_sessions: number }>(
    `SELECT c.placement, c.scope, SUM(c.issue_count) AS issued, (SELECT COUNT(*) FROM canary_exposures ce WHERE ce.canary_id IN (SELECT id FROM canaries c2 WHERE c2.placement = c.placement AND c2.scope = c.scope) AND ce.first_at >= ? AND ce.first_at <= ?) AS exposed_sessions FROM canaries c GROUP BY c.placement, c.scope ORDER BY c.scope, c.placement`,
    range.since, range.until,
  );
  const sightingsByPlacement = d.db.all<{ placement: string; scope: string; n: number; xs: number; xa: number }>(
    `SELECT c.placement, c.scope, COUNT(*) AS n, SUM(cs.cross_session) AS xs, SUM(cs.cross_actor) AS xa FROM canary_sightings cs JOIN canaries c ON c.id = cs.canary_id WHERE cs.ts >= ? AND cs.ts <= ?${sf.sql.replace('synthetic', 'cs.synthetic')} GROUP BY c.placement, c.scope`,
    range.since, range.until, ...sf.args,
  );
  const byWhere = d.db.all<{ w: string; n: number }>(`SELECT CASE WHEN seen_in LIKE 'query:%' THEN 'query' WHEN seen_in LIKE 'header:%' THEN 'header' WHEN seen_in LIKE 'cookie:%' THEN 'cookie' WHEN seen_in LIKE 'external:%' THEN 'external' ELSE seen_in END AS w, COUNT(*) AS n FROM canary_sightings WHERE ts >= ? AND ts <= ?${sf.sql} GROUP BY w ORDER BY n DESC`, range.since, range.until, ...sf.args);
  const recent = d.db.all<Record<string, unknown>>(`SELECT cs.*, c.placement, c.scope, c.page_id FROM canary_sightings cs LEFT JOIN canaries c ON c.id = cs.canary_id WHERE cs.ts >= ? AND cs.ts <= ?${sf.sql.replace('synthetic', 'cs.synthetic')} ORDER BY cs.ts DESC LIMIT 100`, range.since, range.until, ...sf.args);
  // propagation graph: canary -> sessions that were exposed -> sessions that presented it
  const edges = d.db.all<{ canary_id: string; exposure_session_id: string | null; session_id: string | null; ts: number; cross_session: number; cross_actor: number; external: number }>(
    `SELECT canary_id, exposure_session_id, session_id, ts, cross_session, cross_actor, external FROM canary_sightings WHERE ts >= ? AND ts <= ? AND (cross_session = 1 OR external = 1)${sf.sql} ORDER BY ts DESC LIMIT 300`,
    range.since, range.until, ...sf.args,
  );
  const external = d.db.all<Record<string, unknown>>('SELECT ts, canary_id, seen_in, detail FROM canary_sightings WHERE external = 1 ORDER BY ts DESC LIMIT 50');
  return { placements: byPlacement, sightings_by_placement: sightingsByPlacement, sightings_by_where: byWhere, recent, propagation_edges: edges, external };
}

export function recordExternalSighting(d: QueryDeps, input: { canary_id: string; source: string; url?: string; note?: string }): { ok: boolean; error?: string } {
  const id = input.canary_id.trim().toUpperCase();
  if (!/^QUANTARA-SWARMGLASS-[A-Z]{1,2}\d{0,5}-[0-9A-F]{6}$/.test(id)) return { ok: false, error: 'not a canary id' };
  const source = input.source.replace(/[^\w.\-: ]/g, '').slice(0, 64) || 'unknown';
  const detail = [input.url ?? '', input.note ?? ''].filter(Boolean).join(' — ').slice(0, 500);
  d.db.run('INSERT INTO canary_sightings (ts, canary_id, session_id, actor_hash, seen_in, path, detail, cross_session, cross_actor, exposure_session_id, delta_ms, external, synthetic) VALUES (?, ?, NULL, NULL, ?, NULL, ?, 1, 1, NULL, NULL, 1, 0)', Date.now(), id, `external:${source}`, detail);
  return { ok: true };
}

export function experimentList(d: QueryDeps): Record<string, unknown> {
  const runs = d.db.all('SELECT experiment_id, version, activated_at, deactivated_at, seed_version, heuristics_version FROM experiment_runs ORDER BY activated_at DESC');
  return { experiments: d.registry.defs, errors: d.registry.errors, runs, seed_version: d.cat.version };
}

export function experimentDetail(d: QueryDeps, id: string, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Comparison | null {
  const def = d.registry.get(id);
  if (!def) return null;
  return compareExperiment(d.db, d.cat, def, range, synthetic, d.registry.active());
}

export function motifs(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all', n = 3): Array<Record<string, unknown>> {
  const sf = synthFilter(synthetic);
  const sessions = d.db.all<{ id: string }>(`SELECT id FROM sessions WHERE started_at >= ? AND started_at <= ? AND n_requests >= ?${sf.sql} ORDER BY started_at DESC LIMIT 600`, range.since, range.until, n, ...sf.args);
  const counts = new Map<string, { n: number; sessions: Set<string> }>();
  for (const s of sessions) {
    // single quotes on purpose: the sqlite node ships has double-quoted string literals turned off, so ":" is a column
    const seq = d.db.all<{ k: string }>("SELECT COALESCE(page_id, resource_kind || ':' || path) AS k FROM events WHERE session_id = ? ORDER BY ts LIMIT 500", s.id).map((r) => r.k);
    for (const g of new Set(ngrams(seq, n))) {
      const c = counts.get(g) ?? { n: 0, sessions: new Set() };
      c.n++;
      c.sessions.add(s.id);
      counts.set(g, c);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c.sessions.size >= 2)
    .sort((a, b) => b[1].sessions.size - a[1].sessions.size)
    .slice(0, 60)
    .map(([motif, c]) => ({ motif, sessions: c.sessions.size, sample: [...c.sessions].slice(0, 5) }));
}

export function anomalies(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Record<string, unknown> {
  const sf = synthFilter(synthetic);
  const malformed = d.db.all(`SELECT ts, session_id, method, path, status, malformed FROM events WHERE ts >= ? AND ts <= ? AND malformed IS NOT NULL${sf.sql} ORDER BY ts DESC LIMIT 100`, range.since, range.until, ...sf.args);
  const limited = d.db.all<{ session_id: string; n: number; ua_family: string | null }>(`SELECT e.session_id, COUNT(*) AS n, s.ua_family FROM events e JOIN sessions s ON s.id = e.session_id WHERE e.ts >= ? AND e.ts <= ? AND e.status = 429${sf.sql.replace('synthetic', 'e.synthetic')} GROUP BY e.session_id ORDER BY n DESC LIMIT 30`, range.since, range.until, ...sf.args);
  const methods = d.db.all<{ method: string; n: number }>(`SELECT method, COUNT(*) AS n FROM events WHERE ts >= ? AND ts <= ? AND method NOT IN ('GET','HEAD')${sf.sql} GROUP BY method ORDER BY n DESC`, range.since, range.until, ...sf.args);
  const posts = d.db.all(`SELECT ts, session_id, path, status, body_bytes, body_ctype FROM events WHERE ts >= ? AND ts <= ? AND method IN ('POST','PUT','PATCH')${sf.sql} ORDER BY ts DESC LIMIT 50`, range.since, range.until, ...sf.args);
  const bursts = d.db.all<{ session_id: string; n: number; ua_family: string | null }>(`SELECT e.session_id, COUNT(*) AS n, s.ua_family FROM events e JOIN sessions s ON s.id = e.session_id WHERE e.ts >= ? AND e.ts <= ?${sf.sql.replace('synthetic', 'e.synthetic')} GROUP BY e.session_id HAVING n >= 200 ORDER BY n DESC LIMIT 30`, range.since, range.until, ...sf.args);
  // 404s come in three kinds: the skin's own red links (every page gets a Discussion tab, most have no talk page),
  // foreign paths nothing on the site points at, and the scanner alphabet. in one list the scanners vanished
  // under a wall of /wiki/Talk:
  const dead = d.db.all<{ path: string; n: number; s: number }>(`SELECT path, COUNT(*) AS n, COUNT(DISTINCT session_id) AS s FROM events WHERE ts >= ? AND ts <= ? AND status = 404${sf.sql} GROUP BY path ORDER BY n DESC LIMIT 400`, range.since, range.until, ...sf.args);
  const redLinks = dead.filter((r) => r.path.startsWith('/wiki/')).slice(0, 40);
  const scannerPaths = dead.filter((r) => !r.path.startsWith('/wiki/') && isScannerPath(r.path)).slice(0, 40);
  const foreign = dead.filter((r) => !r.path.startsWith('/wiki/') && !isScannerPath(r.path)).slice(0, 40);
  const probes = d.db.all(`SELECT ts, session_id, path, status FROM events WHERE ts >= ? AND ts <= ? AND (malformed LIKE '%probe_pattern%' OR malformed LIKE '%scanner_path%')${sf.sql} ORDER BY ts DESC LIMIT 50`, range.since, range.until, ...sf.args);
  // scanner sessions, judged by what they asked for rather than by the flag, so rows recorded before the flag
  // existed count too: three or more misses from the scanner alphabet
  const scannerCandidates = d.db.all<{ session_id: string; n: number; ua_family: string | null; started_at: number; n_requests: number }>(
    `SELECT e.session_id, COUNT(*) AS n, s.ua_family, s.started_at, s.n_requests FROM events e JOIN sessions s ON s.id = e.session_id WHERE e.ts >= ? AND e.ts <= ? AND e.status = 404 AND e.path NOT LIKE '/wiki/%'${sf.sql.replace('synthetic', 'e.synthetic')} GROUP BY e.session_id HAVING n >= 3 ORDER BY n DESC LIMIT 60`,
    range.since, range.until, ...sf.args,
  );
  const scanners: Array<Record<string, unknown>> = [];
  for (const c of scannerCandidates) {
    const paths = d.db.all<{ path: string }>("SELECT path FROM events WHERE session_id = ? AND status = 404 AND path NOT LIKE '/wiki/%' ORDER BY ts LIMIT 300", c.session_id).map((r) => r.path);
    const hits = paths.filter(isScannerPath);
    if (hits.length < 3) continue;
    scanners.push({ session_id: c.session_id, started_at: c.started_at, ua_family: c.ua_family, requests: c.n_requests, missing: c.n, scanner_hits: hits.length, sample: hits.slice(0, 6) });
  }
  const searches = d.db.all<{ q: string; n: number }>(`SELECT json_extract(query_json, '$.search') AS q, COUNT(*) AS n FROM events WHERE ts >= ? AND ts <= ? AND page_id = 'Special:Search' AND query_json IS NOT NULL${sf.sql} GROUP BY q ORDER BY n DESC LIMIT 40`, range.since, range.until, ...sf.args);
  const swarms = d.db.all<{ id: string; window_start: number; window_end: number; size: number; swarm_score: number; label: string; summary_json: string | null }>(`SELECT id, window_start, window_end, size, swarm_score, label, summary_json FROM clusters WHERE kind = 'swarm' AND window_end >= ?${sf.sql} ORDER BY size DESC LIMIT 10`, range.since, ...sf.args)
    .map((r) => ({ ...r, summary: parseSummary(r.summary_json), summary_json: undefined }));
  return { swarms, scanners, malformed, rate_limited: limited, methods, posts, heavy_sessions: bursts, dead_paths: foreign, scanner_paths: scannerPaths, red_links: redLinks, probes, searches };
}

export function syntheticReport(d: QueryDeps): Record<string, unknown> {
  const runs = d.db.all<{ id: string; started_at: number; finished_at: number | null; personas_json: string; note: string | null }>('SELECT * FROM synthetic_runs ORDER BY started_at DESC LIMIT 50');
  const confusion = d.db.all<{ persona: string | null; cls: string | null; n: number }>('SELECT synthetic_persona AS persona, likely_class AS cls, COUNT(*) AS n FROM sessions WHERE synthetic = 1 GROUP BY persona, cls');
  const personas = [...new Set(confusion.map((r) => r.persona ?? 'unknown'))].sort();
  const classes = [...new Set(confusion.map((r) => r.cls ?? 'unscored'))].sort();
  const cells: Record<string, Record<string, number>> = {};
  for (const r of confusion) (cells[r.persona ?? 'unknown'] ??= {})[r.cls ?? 'unscored'] = r.n;
  const traitMeans = d.db.all<{ persona: string | null; scores_json: string | null }>('SELECT synthetic_persona AS persona, scores_json FROM sessions WHERE synthetic = 1 AND scores_json IS NOT NULL LIMIT 2000');
  const agg: Record<string, Record<string, { sum: number; n: number }>> = {};
  for (const r of traitMeans) {
    let sc: Scores | null = null;
    try {
      sc = JSON.parse(r.scores_json ?? 'null') as Scores;
    } catch {
      sc = null;
    }
    if (!sc) continue;
    const p = r.persona ?? 'unknown';
    for (const [t, v] of Object.entries(sc.traits)) {
      const cell = ((agg[p] ??= {})[t] ??= { sum: 0, n: 0 });
      cell.sum += v.value;
      cell.n++;
    }
  }
  const traits: Record<string, Record<string, number>> = {};
  for (const [p, m] of Object.entries(agg)) traits[p] = Object.fromEntries(Object.entries(m).map(([t, c]) => [t, Math.round((c.sum / c.n) * 100) / 100]));
  return { runs: runs.map((r) => ({ ...r, personas: JSON.parse(r.personas_json), personas_json: undefined })), personas, classes, confusion: cells, trait_means: traits };
}

export function timeToPage(d: QueryDeps, pageId: string, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Record<string, unknown> {
  const sf = synthFilter(synthetic).sql.replace('synthetic', 's.synthetic');
  const args = synthFilter(synthetic).args;
  const rows = d.db.all<{ dt: number; cls: string | null; via: string; session_id: string }>(`SELECT pd.ts - s.started_at AS dt, s.likely_class AS cls, pd.via, pd.session_id FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.page_id = ? AND pd.ts >= ? AND pd.ts <= ?${sf} ORDER BY dt`, pageId, range.since, range.until, ...args);
  const dts = rows.map((r) => r.dt);
  return { page: pageId, n: rows.length, median_ms: median(dts), p90_ms: percentile(dts, 90), rows: rows.slice(0, 200) };
}

// ---- hour-of-day × day-of-week request counts, utc. a pool that works office hours somewhere has a shape here ----

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function activityGrid(db: Db, where: string, args: unknown[]): { rows: string[]; cols: string[]; cells: Record<string, Record<string, number>>; total: number; peak: number } {
  // unix day 0 was a thursday; integer arithmetic throughout, ts is an integer column
  const rows = db.all<{ dow: number; hour: number; n: number }>(`SELECT ((ts / 86400000) + 4) % 7 AS dow, (ts / 3600000) % 24 AS hour, COUNT(*) AS n FROM events WHERE ${where} GROUP BY dow, hour`, ...args);
  const cells: Record<string, Record<string, number>> = {};
  let total = 0;
  let peak = 0;
  for (const r of rows) {
    (cells[DOW[r.dow] as string] ??= {})[String(r.hour)] = r.n;
    total += r.n;
    if (r.n > peak) peak = r.n;
  }
  return { rows: DOW, cols: Array.from({ length: 24 }, (_, h) => String(h)), cells, total, peak };
}

// ---- the daily rollups the scheduler writes every ten minutes: the long memory. events age out after
// SWARMGLASS_RETENTION_DAYS, these rows do not, and until now nothing read them ----

export function dailyHistory(d: QueryDeps, days: number, synthetic: 'real' | 'synthetic' | 'all'): Array<Record<string, unknown>> {
  const since = dayKey(Date.now() - days * 86_400_000);
  const rows = d.db.all<{ day: string; synthetic: number; requests: number; sessions: number; errors: number; canary_sightings: number; by_class_json: string | null; by_kind_json: string | null }>(
    'SELECT day, synthetic, requests, sessions, errors, canary_sightings, by_class_json, by_kind_json FROM daily_stats WHERE day >= ? ORDER BY day ASC',
    since,
  );
  const byDay = new Map<string, { day: string; requests: number; sessions: number; errors: number; canary_sightings: number; by_class: Record<string, number>; by_kind: Record<string, number> }>();
  for (const r of rows) {
    if (synthetic !== 'all' && r.synthetic !== (synthetic === 'synthetic' ? 1 : 0)) continue;
    const cur = byDay.get(r.day) ?? { day: r.day, requests: 0, sessions: 0, errors: 0, canary_sightings: 0, by_class: {}, by_kind: {} };
    cur.requests += r.requests;
    cur.sessions += r.sessions;
    cur.errors += r.errors;
    cur.canary_sightings += r.canary_sightings;
    for (const [k, v] of Object.entries(parseCounts(r.by_class_json))) cur.by_class[k] = (cur.by_class[k] ?? 0) + v;
    for (const [k, v] of Object.entries(parseCounts(r.by_kind_json))) cur.by_kind[k] = (cur.by_kind[k] ?? 0) + v;
    byDay.set(r.day, cur);
  }
  return [...byDay.values()];
}

function parseCounts(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number') out[k] = n;
    return out;
  } catch {
    return {};
  }
}

// ---- client signatures: the wire order of a request's headers. a user-agent is a string anyone can set; the
// order an http stack emits its headers in is set by the stack and rarely touched. one order behind several
// user-agent strings is one client wearing masks, which is the thing the swarm detector cannot see, since it
// groups by the mask. two sessions minimum, or every one-off client is its own row ----

export function signatures(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Array<Record<string, unknown>> {
  const sf = synthFilter(synthetic);
  // keyed on the stack signature (names minus cookie, referer and the proxy's additions) so a session that
  // returned its cookie is one row, not two; the names shown are one request's, as sent
  const rows = d.db.all<{ h: string; names: string | null; sessions: number; actors: number; requests: number; prefixes: number; uas: number; families: string | null; first: number; last: number; pages: number; versions: string | null; tls: string | null; encodings: string | null }>(
    `SELECT e.stack_hash AS h, MIN(e.header_names) AS names, COUNT(DISTINCT e.session_id) AS sessions, COUNT(DISTINCT s.actor_hash) AS actors, COUNT(*) AS requests, COUNT(DISTINCT s.ip_trunc) AS prefixes, COUNT(DISTINCT s.ua_hash) AS uas, GROUP_CONCAT(DISTINCT s.ua_family) AS families, MIN(e.ts) AS first, MAX(e.ts) AS last, COUNT(DISTINCT e.page_id) AS pages, GROUP_CONCAT(DISTINCT e.http_version) AS versions, GROUP_CONCAT(DISTINCT json_extract(e.extra_json, '$.tls')) AS tls, GROUP_CONCAT(DISTINCT e.accept_enc) AS encodings
     FROM events e JOIN sessions s ON s.id = e.session_id
     WHERE e.ts >= ? AND e.ts <= ? AND e.stack_hash IS NOT NULL AND e.header_names != ''${sf.sql.replace('synthetic', 'e.synthetic')}
     GROUP BY e.stack_hash HAVING sessions >= 2 ORDER BY sessions DESC LIMIT 80`,
    range.since, range.until, ...sf.args,
  );
  return rows.map((r) => {
    const uaRows = d.db.all<{ ua: string | null; n: number }>('SELECT ua, COUNT(*) AS n FROM sessions WHERE id IN (SELECT DISTINCT session_id FROM events WHERE stack_hash = ? AND ts >= ? AND ts <= ?) GROUP BY ua ORDER BY n DESC LIMIT 4', r.h, range.since, range.until);
    const names = (r.names ?? '').split(',').filter(Boolean);
    const split = (s: string | null) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return {
      signature: r.h,
      header_names: names,
      sessions: r.sessions,
      actors: r.actors,
      requests: r.requests,
      prefixes: r.prefixes,
      ua_strings: r.uas,
      families: split(r.families),
      http_versions: split(r.versions),
      // group_concat splits the tls string's own spaces apart from nothing; the values carry no commas
      tls: split(r.tls),
      accept_encodings: split(r.encodings).slice(0, 4),
      pages: r.pages,
      first_seen: r.first,
      last_seen: r.last,
      ua_samples: uaRows.map((u) => ({ ua: (u.ua ?? '').slice(0, 160), sessions: u.n })),
      // one stack, several masks
      masks: r.uas > 1,
      // many addresses, one stack, one or two requests each: the swarm shape, whatever the user-agent says
      spread: r.prefixes >= 8 && r.requests / r.sessions <= 2,
    };
  });
}

// ---- one actor fingerprint, every session it had. the memory question, asked across sessions: did a later
// session go straight to pages only an earlier one was shown, and did it present a canary it was shown last time? ----

export function actorDetail(d: QueryDeps, actorHash: string): Record<string, unknown> | null {
  const { db } = d;
  const sessions = db.all<Record<string, unknown>>('SELECT id, kind, started_at, last_seen_at, ended_at, ip_trunc, ua, ua_family, cookie_returned, n_requests, n_unique_pages, n_machine, n_disallowed, n_errors, likely_class, class_confidence, cluster_id, synthetic, cohorts_json FROM sessions WHERE actor_hash = ? ORDER BY started_at ASC LIMIT 200', actorHash).map(decodeSessionRow);
  if (!sessions.length) return null;
  const ids = sessions.map((s) => String(s.id));
  const placeholders = ids.map(() => '?').join(',');
  const disc = db.all<{ session_id: string; page_id: string; ts: number; via: string; discover_class: string | null }>(`SELECT session_id, page_id, ts, via, discover_class FROM page_discoveries WHERE session_id IN (${placeholders}) ORDER BY ts ASC`, ...ids);
  const pageMatrix: Record<string, string[]> = {};
  const firstReached: Record<string, { session_id: string; ts: number; via: string; discover_class: string | null }> = {};
  for (const r of disc) {
    (pageMatrix[r.page_id] ??= []).push(r.session_id);
    if (!firstReached[r.page_id]) firstReached[r.page_id] = { session_id: r.session_id, ts: r.ts, via: r.via, discover_class: r.discover_class };
  }
  const exposures = db.all<{ session_id: string; canary_id: string; first_at: number; placement: string }>(`SELECT session_id, canary_id, first_at, placement FROM canary_exposures WHERE session_id IN (${placeholders}) ORDER BY first_at ASC`, ...ids);
  const exposedBySession: Record<string, number> = {};
  const firstExposure = new Map<string, { session_id: string; first_at: number; placement: string }>();
  for (const e of exposures) {
    exposedBySession[e.session_id] = (exposedBySession[e.session_id] ?? 0) + 1;
    if (!firstExposure.has(e.canary_id)) firstExposure.set(e.canary_id, { session_id: e.session_id, first_at: e.first_at, placement: e.placement });
  }
  const sightings = db.all<{ ts: number; session_id: string; canary_id: string; seen_in: string; cross_session: number; cross_actor: number; exposure_session_id: string | null; delta_ms: number | null }>(`SELECT ts, session_id, canary_id, seen_in, cross_session, cross_actor, exposure_session_id, delta_ms FROM canary_sightings WHERE session_id IN (${placeholders}) ORDER BY ts ASC`, ...ids);
  // a canary presented in one session that this actor was shown in an *earlier* one: carried over the boundary
  const enriched = sightings.map((s) => {
    const fx = firstExposure.get(s.canary_id);
    const carried = fx && fx.session_id !== s.session_id && fx.first_at < s.ts ? fx : null;
    return { ...s, carried_from: carried ? carried.session_id : null, carried_placement: carried ? carried.placement : null, carried_after_ms: carried ? s.ts - carried.first_at : null };
  });
  const pages = Object.keys(pageMatrix);
  const classes: Record<string, number> = {};
  for (const s of sessions) {
    const k = String(s.likely_class ?? 'unscored');
    classes[k] = (classes[k] ?? 0) + 1;
  }
  return {
    actor_hash: actorHash,
    summary: {
      sessions: sessions.length,
      first_seen: Math.min(...sessions.map((s) => Number(s.started_at))),
      last_seen: Math.max(...sessions.map((s) => Number(s.last_seen_at))),
      requests: sessions.reduce((a, s) => a + Number(s.n_requests), 0),
      distinct_pages: pages.length,
      pages_seen_in_more_than_one_session: pages.filter((p) => new Set(pageMatrix[p]).size > 1).length,
      canaries_exposed: firstExposure.size,
      canaries_carried_across_sessions: enriched.filter((s) => s.carried_from).length,
      ua_strings: new Set(sessions.map((s) => s.ua)).size,
      prefixes: new Set(sessions.map((s) => s.ip_trunc)).size,
      classes,
    },
    sessions,
    page_matrix: pageMatrix,
    first_reached: firstReached,
    exposed_by_session: exposedBySession,
    sightings: enriched,
  };
}

// ---- hand-offs: who got a url from whom. a reach of a page the actor was never shown, right after another actor
// was shown a page that links there. the shared-queue signature of a corpus-building pool, measured over every
// page in the seed's link graph and every actor in the range, whatever strings and stacks they wear ----

export function handoffs(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Record<string, unknown> {
  const { db } = d;
  const sf = synthFilter(synthetic);
  const graph = buildLinkGraph(d.cat, d.registry.active().flatMap((x) => x.targets));
  const discoveries: Discovery[] = db.all<{ session_id: string; page_id: string; ts: number; via: string; actor_hash: string }>(
    `SELECT pd.session_id, pd.page_id, pd.ts, pd.via, s.actor_hash FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.ts >= ? AND pd.ts <= ?${sf.sql.replace('synthetic', 's.synthetic')} ORDER BY pd.ts LIMIT 50000`,
    range.since, range.until, ...sf.args,
  ).map((r) => ({ session: r.session_id, actor: r.actor_hash, page: r.page_id, ts: r.ts, via: r.via }));
  // the handing side may sit up to a day before the range, so a reach at the start of the window has its source
  const fetches: Array<Fetch & { page: string }> = db.all<{ ts: number; page_id: string | null; resource_kind: string; path: string; session_id: string; actor_hash: string }>(
    `SELECT e.ts, e.page_id, e.resource_kind, e.path, e.session_id, s.actor_hash FROM events e JOIN sessions s ON s.id = e.session_id WHERE e.ts >= ? AND e.ts <= ? AND e.status < 400 AND (e.page_id IS NOT NULL AND e.resource_kind IN ('page', 'alt', 'attachment') OR e.resource_kind IN ('robots', 'sitemap', 'feed', 'manifest', 'api', 'index'))${sf.sql.replace('synthetic', 'e.synthetic')} ORDER BY e.ts LIMIT 200000`,
    range.since - 24 * 3_600_000, range.until, ...sf.args,
  )
    .map((r): (Fetch & { page: string }) | null => {
      const page = r.page_id && ['page', 'alt', 'attachment'].includes(r.resource_kind) ? r.page_id : channelPage(r.resource_kind, r.path);
      return page ? { ts: r.ts, actor: r.actor_hash, session: r.session_id, page } : null;
    })
    .filter((x): x is Fetch & { page: string } => x !== null);
  const r = findHandoffs(graph, discoveries, fetches);
  const comps = handoffComponents(r.handoffs).slice(0, 12);
  const actorIds = [...new Set([...comps.flatMap((c) => c.actors), ...r.handoffs.slice(-80).flatMap((h) => [h.from_actor, h.to_actor])])];
  const actors = actorInfo(d, actorIds);
  const components = comps.map((c) => {
    const members = c.actors.map((a) => actors.get(a) ?? { actor: a, ua_family: null, sessions: 0, prefixes: 0, cluster_id: null, likely_class: null });
    const families = [...new Set(members.map((m) => m.ua_family ?? 'none'))].sort();
    const prefixes = members.reduce((acc, m) => acc + m.prefixes, 0);
    const swarms = [...new Set(members.map((m) => m.cluster_id).filter((x): x is string => Boolean(x) && (x as string).startsWith('SW-')))];
    const edges = r.handoffs.filter((h) => c.actors.includes(h.from_actor) && c.actors.includes(h.to_actor));
    const lags = edges.map((h) => h.lag_ms);
    return { actors: members.slice(0, 40), actor_count: c.actors.length, edges: c.edges, pages: c.pages, families, prefixes, swarms, median_lag_ms: lags.length ? median(lags) : null, first: edges.length ? edges[0]!.ts : null, last: edges.length ? edges[edges.length - 1]!.ts : null };
  });
  const sample = r.handoffs.slice(-80).reverse().map((h) => ({ ...h, from_family: actors.get(h.from_actor)?.ua_family ?? null, to_family: actors.get(h.to_actor)?.ua_family ?? null }));
  return { considered: r.considered, explained: r.explained, handoffs: r.handoffs.length, unsourced: r.unsourced, share: r.share, median_lag_ms: r.median_lag_ms, top_pages: r.top_pages, components, sample };
}

interface ActorInfo {
  actor: string;
  ua_family: string | null;
  sessions: number;
  prefixes: number;
  cluster_id: string | null;
  likely_class: string | null;
}

function actorInfo(d: QueryDeps, ids: string[]): Map<string, ActorInfo> {
  const out = new Map<string, ActorInfo>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    for (const r of d.db.all<ActorInfo>(`SELECT actor_hash AS actor, MAX(ua_family) AS ua_family, COUNT(*) AS sessions, COUNT(DISTINCT ip_trunc) AS prefixes, MAX(cluster_id) AS cluster_id, MAX(likely_class) AS likely_class FROM sessions WHERE actor_hash IN (${chunk.map(() => '?').join(',')}) GROUP BY actor_hash`, ...chunk)) out.set(r.actor, r);
  }
  return out;
}

// ---- llm traffic: every self-declared model crawler and on-demand fetcher, what it reads, whether it comes as a
// pool, and whether urls move between it and anyone else. the families are claims; the rest is behaviour ----

export function llmTraffic(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all'): Record<string, unknown> {
  const { db } = d;
  const sf = synthFilter(synthetic);
  const aiFamilies = UA_RULES.filter((r) => r.category === 'ai_crawler' || r.category === 'ai_fetcher').map((r) => r.family);
  const ph = aiFamilies.map(() => '?').join(',');
  const rows = db.all<{ ua_family: string; sessions: number; actors: number; prefixes: number; requests: number; machine: number; disallowed: number; cookies: number; one_hit: number; first: number; last: number; clusters: string | null }>(
    `SELECT ua_family, COUNT(*) AS sessions, COUNT(DISTINCT actor_hash) AS actors, COUNT(DISTINCT ip_trunc) AS prefixes, SUM(n_requests) AS requests, SUM(n_machine) AS machine, SUM(n_disallowed) AS disallowed, SUM(cookie_returned) AS cookies, SUM(CASE WHEN n_requests <= 2 THEN 1 ELSE 0 END) AS one_hit, MIN(started_at) AS first, MAX(last_seen_at) AS last, GROUP_CONCAT(DISTINCT cluster_id) AS clusters FROM sessions WHERE started_at >= ? AND started_at <= ? AND ua_family IN (${ph})${sf.sql} GROUP BY ua_family ORDER BY sessions DESC`,
    range.since, range.until, ...aiFamilies, ...sf.args,
  );
  // urls moving between actors, with each side's family, once for every family below
  const hx = handoffs(d, range, synthetic) as { sample: Array<{ from_family: string | null; to_family: string | null }>; handoffs: number };
  const families = rows.map((r) => {
    const esf = sf.sql.replace('synthetic', 'e.synthetic');
    const ev = db.get<{ n: number; alt: number; llms: number; manifests: number; robots: number; hidden: number; h2: number; pages: number; conditional: number }>(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN e.resource_kind = 'alt' THEN 1 ELSE 0 END) AS alt, SUM(CASE WHEN e.route_id = 'llms_txt' THEN 1 ELSE 0 END) AS llms, SUM(CASE WHEN e.resource_kind IN ('manifest', 'api') THEN 1 ELSE 0 END) AS manifests, SUM(CASE WHEN e.resource_kind = 'robots' THEN 1 ELSE 0 END) AS robots, SUM(CASE WHEN e.discover_class IS NOT NULL AND e.discover_class != 'visible' AND e.status < 400 THEN 1 ELSE 0 END) AS hidden, SUM(CASE WHEN e.http_version = '2.0' OR e.http_version = '3.0' THEN 1 ELSE 0 END) AS h2, COUNT(DISTINCT e.page_id) AS pages, SUM(CASE WHEN e.header_names LIKE '%if-none-match%' OR e.header_names LIKE '%if-modified-since%' THEN 1 ELSE 0 END) AS conditional FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.ua_family = ? AND e.ts >= ? AND e.ts <= ?${esf}`,
      r.ua_family, range.since, range.until, ...sf.args,
    ) ?? { n: 0, alt: 0, llms: 0, manifests: 0, robots: 0, hidden: 0, h2: 0, pages: 0, conditional: 0 };
    const topPages = db.all<{ page_id: string; n: number }>(`SELECT e.page_id, COUNT(DISTINCT e.session_id) AS n FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.ua_family = ? AND e.ts >= ? AND e.ts <= ? AND e.page_id IS NOT NULL AND e.status < 400${esf} GROUP BY e.page_id ORDER BY n DESC LIMIT 6`, r.ua_family, range.since, range.until, ...sf.args);
    const stacks = db.all<{ k: string | null; n: number }>(`SELECT e.stack_hash AS k, COUNT(*) AS n FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.ua_family = ? AND e.ts >= ? AND e.ts <= ?${esf} GROUP BY e.stack_hash ORDER BY n DESC LIMIT 4`, r.ua_family, range.since, range.until, ...sf.args);
    const tls = db.all<{ k: string | null; n: number }>(`SELECT json_extract(e.extra_json, '$.tls') AS k, COUNT(*) AS n FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.ua_family = ? AND e.ts >= ? AND e.ts <= ?${esf} GROUP BY k ORDER BY n DESC LIMIT 3`, r.ua_family, range.since, range.until, ...sf.args);
    const classes = Object.fromEntries(db.all<{ c: string | null; n: number }>(`SELECT likely_class AS c, COUNT(*) AS n FROM sessions WHERE ua_family = ? AND started_at >= ? AND started_at <= ?${sf.sql} GROUP BY c ORDER BY n DESC`, r.ua_family, range.since, range.until, ...sf.args).map((x) => [x.c ?? 'unscored', x.n]));
    const canaries = db.get<{ n: number; xa: number }>(`SELECT COUNT(*) AS n, SUM(cs.cross_actor) AS xa FROM canary_sightings cs JOIN sessions s ON s.id = cs.session_id WHERE s.ua_family = ? AND cs.ts >= ? AND cs.ts <= ?`, r.ua_family, range.since, range.until) ?? { n: 0, xa: 0 };
    const out = hx.sample.filter((h) => h.from_family === r.ua_family).length;
    const inn = hx.sample.filter((h) => h.to_family === r.ua_family).length;
    const partners = [...new Set(hx.sample.filter((h) => h.from_family === r.ua_family || h.to_family === r.ua_family).map((h) => (h.from_family === r.ua_family ? h.to_family : h.from_family) ?? 'none'))];
    const n = ev.n || 1;
    return {
      family: r.ua_family,
      category: familyCategory(r.ua_family),
      sessions: r.sessions,
      actors: r.actors,
      prefixes: r.prefixes,
      requests: r.requests,
      one_hit_share: r.sessions ? Math.round((r.one_hit / r.sessions) * 100) / 100 : 0,
      cookie_share: r.sessions ? Math.round((r.cookies / r.sessions) * 100) / 100 : 0,
      pages: ev.pages,
      alt_share: Math.round((ev.alt / n) * 1000) / 1000,
      llms_txt: ev.llms,
      manifests: ev.manifests,
      robots: ev.robots,
      disallowed: r.disallowed,
      hidden_reaches: ev.hidden,
      h2_share: Math.round((ev.h2 / n) * 1000) / 1000,
      conditional_share: Math.round((ev.conditional / n) * 1000) / 1000,
      stacks: stacks.map((s) => ({ stack: s.k, requests: s.n })),
      tls: tls.filter((t) => t.k).map((t) => ({ tls: t.k, requests: t.n })),
      classes,
      pools: (r.clusters ?? '').split(',').filter((c) => c.startsWith('SW-')),
      canaries: { presented: canaries.n, cross_actor: canaries.xa ?? 0 },
      handoffs: { out, in: inn, partners },
      top_pages: topPages.map((p) => ({ page: p.page_id, sessions: p.n })),
      first_seen: r.first,
      last_seen: r.last,
    };
  });
  const pools = db.all<{ id: string; label: string; size: number; summary_json: string | null; window_start: number; window_end: number }>("SELECT id, label, size, summary_json, window_start, window_end FROM clusters WHERE kind = 'swarm' AND window_end >= ? ORDER BY size DESC", range.since)
    .map((p) => ({ id: p.id, label: p.label, size: p.size, window_start: p.window_start, window_end: p.window_end, summary: parseSummary(p.summary_json) }))
    .filter((p) => {
      const s = p.summary as { ua_family?: string; families?: string[] } | null;
      return Boolean(s && ((s.ua_family && aiFamilies.includes(s.ua_family)) || (s.families ?? []).some((f) => aiFamilies.includes(f))));
    });
  return { families, pools, handoffs: hx.handoffs, ai_families_known: aiFamilies };
}
