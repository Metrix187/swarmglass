import type { Db } from '../db/db.ts';
import type { Catalog } from '../wiki/content.ts';
import type { ExperimentRegistry } from '../experiments/registry.ts';
import type { EventRow, Features } from '../telemetry/features.ts';
import type { Scores } from '../telemetry/scoring.ts';
import { buildStory } from './story.ts';
import { ngrams } from '../util/text.ts';
import { median, percentile } from '../util/time.ts';
import { compareExperiment, type Comparison } from '../experiments/compare.ts';

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
  const rows = d.db.all<{ id: string; created_at: number; window_start: number; window_end: number; size: number; signals_json: string; swarm_score: number; label: string; synthetic: number }>(
    `SELECT * FROM clusters WHERE window_end >= ?${sf.sql} ORDER BY swarm_score DESC, size DESC LIMIT 100`,
    range.since,
    ...sf.args,
  );
  return rows.map((r) => ({ ...r, signals: JSON.parse(r.signals_json), signals_json: undefined, members: d.db.all<{ id: string; ua_family: string | null; likely_class: string | null; ip_trunc: string | null; n_unique_pages: number; started_at: number }>('SELECT id, ua_family, likely_class, ip_trunc, n_unique_pages, started_at FROM sessions WHERE cluster_id = ? ORDER BY started_at', r.id) }));
}

export function clusterDetail(d: QueryDeps, id: string): Record<string, unknown> | null {
  const r = d.db.get<{ id: string; created_at: number; window_start: number; window_end: number; size: number; signals_json: string; swarm_score: number; label: string; synthetic: number }>('SELECT * FROM clusters WHERE id = ?', id);
  if (!r) return null;
  const members = d.db.all<Record<string, unknown>>('SELECT id, actor_hash, ua_family, ua_hash, likely_class, class_confidence, ip_trunc, n_requests, n_unique_pages, started_at, last_seen_at, features_json FROM sessions WHERE cluster_id = ? ORDER BY started_at', id).map(decodeSessionRow);
  const pageMatrix: Record<string, string[]> = {};
  for (const m of members) {
    for (const p of d.db.all<{ page_id: string }>('SELECT page_id FROM page_discoveries WHERE session_id = ?', String(m.id))) {
      (pageMatrix[p.page_id] ??= []).push(String(m.id));
    }
  }
  return { ...r, signals: JSON.parse(r.signals_json), members, page_matrix: pageMatrix };
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
  return compareExperiment(d.db, d.cat, def, range, synthetic);
}

export function motifs(d: QueryDeps, range: Range, synthetic: 'real' | 'synthetic' | 'all', n = 3): Array<Record<string, unknown>> {
  const sf = synthFilter(synthetic);
  const sessions = d.db.all<{ id: string }>(`SELECT id FROM sessions WHERE started_at >= ? AND started_at <= ? AND n_requests >= ?${sf.sql} ORDER BY started_at DESC LIMIT 600`, range.since, range.until, n, ...sf.args);
  const counts = new Map<string, { n: number; sessions: Set<string> }>();
  for (const s of sessions) {
    const seq = d.db.all<{ k: string }>('SELECT COALESCE(page_id, resource_kind || ":" || path) AS k FROM events WHERE session_id = ? ORDER BY ts LIMIT 500', s.id).map((r) => r.k);
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
  const dead = d.db.all<{ path: string; n: number; s: number }>(`SELECT path, COUNT(*) AS n, COUNT(DISTINCT session_id) AS s FROM events WHERE ts >= ? AND ts <= ? AND status = 404${sf.sql} GROUP BY path ORDER BY n DESC LIMIT 40`, range.since, range.until, ...sf.args);
  const probes = d.db.all(`SELECT ts, session_id, path, status FROM events WHERE ts >= ? AND ts <= ? AND malformed LIKE '%probe_pattern%'${sf.sql} ORDER BY ts DESC LIMIT 50`, range.since, range.until, ...sf.args);
  const searches = d.db.all<{ q: string; n: number }>(`SELECT json_extract(query_json, '$.search') AS q, COUNT(*) AS n FROM events WHERE ts >= ? AND ts <= ? AND page_id = 'Special:Search' AND query_json IS NOT NULL${sf.sql} GROUP BY q ORDER BY n DESC LIMIT 40`, range.since, range.until, ...sf.args);
  return { malformed, rate_limited: limited, methods, posts, heavy_sessions: bursts, dead_paths: dead, probes, searches };
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
