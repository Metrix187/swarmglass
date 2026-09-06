import type { Db } from '../db/db.ts';
import type { Logger } from '../log.ts';

// retention + disk guard. both are boring on purpose.

export function purgeOlderThan(db: Db, days: number, log: Logger): Record<string, number> {
  const cutoff = Date.now() - days * 86_400_000;
  const out: Record<string, number> = {};
  db.transaction(() => {
    out.events = db.run('DELETE FROM events WHERE ts < ?', cutoff).changes;
    out.sightings = db.run('DELETE FROM canary_sightings WHERE ts < ? AND external = 0', cutoff).changes;
    out.discoveries = db.run('DELETE FROM page_discoveries WHERE ts < ?', cutoff).changes;
    out.edges = db.run('DELETE FROM nav_edges WHERE ts < ?', cutoff).changes;
    out.exposures = db.run('DELETE FROM canary_exposures WHERE first_at < ?', cutoff).changes;
    out.sessions = db.run('DELETE FROM sessions WHERE last_seen_at < ?', cutoff).changes;
    out.clusters = db.run('DELETE FROM clusters WHERE window_end < ?', cutoff).changes;
    out.console_sessions = db.run('DELETE FROM console_sessions WHERE expires_at < ?', Date.now()).changes;
  });
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (total) log.info('retention purge', { days, ...out });
  return out;
}

export interface DiskGuardState {
  degraded: boolean;
  reason: string | null;
  dbBytes: number;
  limitBytes: number;
}

// past 90% of the cap: stop writing events (sessions still update). past 100%: emergency purge of the oldest 10%.
export function diskGuard(db: Db, maxMb: number, log: Logger): DiskGuardState {
  const bytes = db.sizeBytes();
  const limit = maxMb * 1024 * 1024;
  if (bytes < limit * 0.9) return { degraded: false, reason: null, dbBytes: bytes, limitBytes: limit };
  if (bytes >= limit) {
    const oldest = db.get<{ ts: number }>('SELECT ts FROM events ORDER BY ts ASC LIMIT 1 OFFSET (SELECT COUNT(*) / 10 FROM events)');
    if (oldest) {
      const n = db.run('DELETE FROM events WHERE ts < ?', oldest.ts).changes;
      log.warn('disk guard: emergency purge', { deleted_events: n, bytes, limit });
      db.checkpoint();
      db.exec('VACUUM');
    }
    return { degraded: true, reason: 'over_limit', dbBytes: db.sizeBytes(), limitBytes: limit };
  }
  return { degraded: true, reason: 'near_limit', dbBytes: bytes, limitBytes: limit };
}
