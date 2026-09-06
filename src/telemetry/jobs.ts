import type { Db } from '../db/db.ts';
import type { Logger } from '../log.ts';
import type { Config } from '../config.ts';
import type { Telemetry } from './capture.ts';
import { computeFeatures, type EventRow, type PageInfo, type SessionRow } from './features.ts';
import { score, type Heuristics } from './scoring.ts';
import { clusterSessions, loadClusterSessions } from './cluster.ts';
import { diskGuard, purgeOlderThan } from './retention.ts';
import { randomId } from '../util/hash.ts';
import { dayKey } from '../util/time.ts';

export interface JobDeps {
  cfg: Config;
  db: Db;
  log: Logger;
  telemetry: Telemetry;
  heuristics: () => Heuristics;
  pageInfo: (id: string) => PageInfo | undefined;
}

// scores every session whose events changed since it was last scored.
export function scoreSessions(deps: JobDeps, opts: { debounceMs?: number; limit?: number; all?: boolean } = {}): number {
  const { db, heuristics, pageInfo } = deps;
  const debounce = opts.debounceMs ?? 15_000;
  const limit = opts.limit ?? 300;
  const rows = opts.all
    ? db.all<SessionRow & { scored_at: number | null }>('SELECT id, actor_hash, kind, started_at, last_seen_at, ua, ua_family, cookie_returned, synthetic, scored_at FROM sessions ORDER BY last_seen_at DESC LIMIT ?', limit)
    : db.all<SessionRow & { scored_at: number | null }>(
        'SELECT id, actor_hash, kind, started_at, last_seen_at, ua, ua_family, cookie_returned, synthetic, scored_at FROM sessions WHERE (scored_at IS NULL OR last_seen_at > scored_at) AND last_seen_at < ? ORDER BY last_seen_at ASC LIMIT ?',
        Date.now() - debounce,
        limit,
      );
  let n = 0;
  const h = heuristics();
  for (const s of rows) {
    const events = db.all<EventRow>(
      'SELECT ts, method, path, page_id, resource_kind, discover_class, depth, status, latency_ms, referer, referer_internal, accept, accept_lang, header_count, header_order_hash, header_names, cookie_present, cookie_valid, negotiated, robots_disallowed, canaries_exposed, canaries_seen, query_json, malformed, http_version, extra_json FROM events WHERE session_id = ? ORDER BY ts ASC LIMIT 2000',
      s.id,
    );
    if (!events.length) continue;
    const xs = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM canary_sightings WHERE session_id = ? AND cross_session = 1', s.id)?.n ?? 0;
    const xa = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM canary_sightings WHERE session_id = ? AND cross_actor = 1', s.id)?.n ?? 0;
    const features = computeFeatures(s, events, pageInfo, xs, xa);
    const scores = score(h, features);
    db.run(
      'UPDATE sessions SET features_json = ?, scores_json = ?, likely_class = ?, class_confidence = ?, scored_at = ?, n_unique_pages = ? WHERE id = ?',
      JSON.stringify(features),
      JSON.stringify(scores),
      scores.likely_class,
      scores.confidence,
      Date.now(),
      features.n_unique_pages,
      s.id,
    );
    n++;
  }
  return n;
}

export function runClustering(deps: JobDeps, windowMs = 24 * 3_600_000): number {
  const { db } = deps;
  const since = Date.now() - windowMs;
  const sessions = loadClusterSessions(db, since, 1500);
  const clusters = clusterSessions(sessions);
  db.transaction(() => {
    db.run('DELETE FROM clusters WHERE window_end >= ?', since);
    db.run('UPDATE sessions SET cluster_id = NULL WHERE started_at >= ?', since);
    for (const c of clusters) {
      const id = 'CL-' + randomId(4);
      db.run(
        'INSERT INTO clusters (id, created_at, window_start, window_end, size, signals_json, swarm_score, label, synthetic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        Date.now(),
        c.window_start,
        c.window_end,
        c.members.length,
        JSON.stringify(c.signals),
        c.swarm_score,
        c.label,
        c.synthetic,
      );
      for (const m of c.members) db.run('UPDATE sessions SET cluster_id = ? WHERE id = ?', id, m);
    }
  });
  return clusters.length;
}

export function rollupDaily(deps: JobDeps, day = dayKey(Date.now())): void {
  const { db } = deps;
  const start = Date.parse(day + 'T00:00:00Z');
  const end = start + 86_400_000;
  for (const synthetic of [0, 1]) {
    const req = db.get<{ n: number; errors: number }>('SELECT COUNT(*) AS n, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors FROM events WHERE ts >= ? AND ts < ? AND synthetic = ?', start, end, synthetic);
    const sess = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ? AND synthetic = ?', start, end, synthetic);
    const sight = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM canary_sightings WHERE ts >= ? AND ts < ? AND synthetic = ?', start, end, synthetic);
    const byClass: Record<string, number> = {};
    for (const r of db.all<{ c: string | null; n: number }>('SELECT likely_class AS c, COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ? AND synthetic = ? GROUP BY likely_class', start, end, synthetic)) byClass[r.c ?? 'unscored'] = r.n;
    const byKind: Record<string, number> = {};
    for (const r of db.all<{ k: string; n: number }>('SELECT resource_kind AS k, COUNT(*) AS n FROM events WHERE ts >= ? AND ts < ? AND synthetic = ? GROUP BY resource_kind', start, end, synthetic)) byKind[r.k] = r.n;
    db.run(
      `INSERT INTO daily_stats (day, synthetic, requests, sessions, errors, canary_sightings, by_class_json, by_kind_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, synthetic) DO UPDATE SET requests = excluded.requests, sessions = excluded.sessions, errors = excluded.errors, canary_sightings = excluded.canary_sightings, by_class_json = excluded.by_class_json, by_kind_json = excluded.by_kind_json`,
      day,
      synthetic,
      req?.n ?? 0,
      sess?.n ?? 0,
      req?.errors ?? 0,
      sight?.n ?? 0,
      JSON.stringify(byClass),
      JSON.stringify(byKind),
    );
  }
}

export interface Scheduler {
  stop(): void;
  tick(name: string): void;
}

// all periodic work. every tick is wrapped so one failure never kills the loop.
export function startScheduler(deps: JobDeps): Scheduler {
  const { cfg, db, log, telemetry } = deps;
  const timers: NodeJS.Timeout[] = [];
  const guard = (name: string, fn: () => void) => () => {
    try {
      fn();
    } catch (e) {
      log.error(`job ${name} failed`, { err: e instanceof Error ? e.message : String(e) });
    }
  };
  const jobs: Record<string, () => void> = {
    flush_sessions: guard('flush_sessions', () => {
      telemetry.flushSessions();
      telemetry.expireSessions();
    }),
    score: guard('score', () => {
      const n = scoreSessions(deps);
      if (n) log.debug('scored sessions', { n });
    }),
    cluster: guard('cluster', () => {
      const n = runClustering(deps);
      log.debug('clustering', { clusters: n });
    }),
    rollup: guard('rollup', () => {
      rollupDaily(deps);
      rollupDaily(deps, dayKey(Date.now() - 86_400_000));
    }),
    retention: guard('retention', () => {
      purgeOlderThan(db, cfg.privacy.retentionDays, log);
      db.checkpoint();
    }),
    disk: guard('disk', () => {
      const state = diskGuard(db, cfg.limits.maxDbMb, log);
      if (state.degraded !== telemetry.writer.degraded) {
        log.warn('disk guard state change', { degraded: state.degraded, reason: state.reason, db_mb: Math.round(state.dbBytes / 1048576) });
      }
      telemetry.writer.degraded = state.degraded;
      db.run('INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at', 'disk_guard', JSON.stringify(state), Date.now());
    }),
  };
  const every = (name: string, ms: number) => {
    const t = setInterval(jobs[name] as () => void, ms);
    t.unref();
    timers.push(t);
  };
  every('flush_sessions', 5_000);
  every('score', 30_000);
  every('cluster', 5 * 60_000);
  every('rollup', 10 * 60_000);
  every('retention', 60 * 60_000);
  every('disk', 60_000);
  // run the cheap ones once at boot so the console isn't empty after a restart
  setTimeout(jobs.disk as () => void, 1000).unref();
  setTimeout(jobs.rollup as () => void, 3000).unref();
  return {
    stop: () => timers.forEach((t) => clearInterval(t)),
    tick: (name) => (jobs[name] ?? (() => {}))(),
  };
}
