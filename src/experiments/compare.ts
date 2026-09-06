import type { Db } from '../db/db.ts';
import type { Catalog } from '../wiki/content.ts';
import type { ExperimentDef } from './registry.ts';
import { median, percentile } from '../util/time.ts';

// per-arm outcome comparison. every number is computed from persisted rows, so a
// bundle regenerated later from the same db + definition gives the same table.

export interface ArmStats {
  arm: string;
  label: string;
  value: string;
  sessions: number;
  actors: number;
  classes: Record<string, number>;
  outcomes: Record<string, unknown>;
}

export interface Comparison {
  experiment: ExperimentDef;
  range: { since: number; until: number };
  synthetic: string;
  arms: ArmStats[];
  notes: string[];
  generated_at: number;
  seed_version: string;
}

export function compareExperiment(db: Db, cat: Catalog, def: ExperimentDef, range: { since: number; until: number }, synthetic: 'real' | 'synthetic' | 'all'): Comparison {
  const sf = synthetic === 'all' ? '' : ` AND s.synthetic = ${synthetic === 'synthetic' ? 1 : 0}`;
  const arms: ArmStats[] = [];
  for (const arm of def.arms) {
    const like = `%"${def.id}":"${arm.id}"%`;
    const sessions = db.all<{ id: string; actor_hash: string; started_at: number; likely_class: string | null; max_depth: number }>(`SELECT id, actor_hash, started_at, likely_class, max_depth FROM sessions s WHERE cohorts_json LIKE ? AND started_at >= ? AND started_at <= ?${sf}`, like, range.since, range.until);
    const ids = sessions.map((s) => s.id);
    const classes: Record<string, number> = {};
    for (const s of sessions) classes[s.likely_class ?? 'unscored'] = (classes[s.likely_class ?? 'unscored'] ?? 0) + 1;
    const outcomes: Record<string, unknown> = {};
    for (const o of def.outcomes) {
      switch (o.metric) {
        case 'sessions':
          outcomes[o.id] = sessions.length;
          break;
        case 'class_mix':
          outcomes[o.id] = classes;
          break;
        case 'page_reached': {
          const page = o.page ?? '';
          if (!ids.length) {
            outcomes[o.id] = { reached: 0, rate: null };
            break;
          }
          const n = page === 'api:openapi'
            ? countSessionsWith(db, ids, "route_id = 'openapi'")
            : countSessionsWith(db, ids, 'page_id = ?', page);
          outcomes[o.id] = { reached: n, rate: ids.length ? round(n / ids.length) : null, wilson95: wilson(n, ids.length) };
          break;
        }
        case 'seconds_to_page': {
          const page = o.page ?? '';
          const dts = ids.length ? timesToPage(db, ids, page) : [];
          outcomes[o.id] = { n: dts.length, median_s: dts.length ? round(median(dts) / 1000) : null, p90_s: dts.length ? round(percentile(dts, 90) / 1000) : null };
          break;
        }
        case 'alt_requested': {
          const page = o.page ?? '';
          const n = ids.length ? countSessionsWith(db, ids, "page_id = ? AND resource_kind = 'alt'", page) : 0;
          outcomes[o.id] = { sessions: n, rate: ids.length ? round(n / ids.length) : null };
          break;
        }
        case 'canary_reappeared': {
          const n = ids.length ? countSessionsWith(db, ids, 'canaries_seen IS NOT NULL') : 0;
          outcomes[o.id] = { sessions: n, rate: ids.length ? round(n / ids.length) : null };
          break;
        }
        case 'depth_reached': {
          const depths = sessions.map((s) => s.max_depth);
          outcomes[o.id] = { mean: depths.length ? round(depths.reduce((a, b) => a + b, 0) / depths.length) : null, max: depths.length ? Math.max(...depths) : null };
          break;
        }
      }
    }
    arms.push({ arm: arm.id, label: arm.label, value: String(arm.value), sessions: sessions.length, actors: new Set(sessions.map((s) => s.actor_hash)).size, classes, outcomes });
  }
  const notes: string[] = [
    'Assignment is deterministic per actor (or session) from a salted hash; arms are balanced in expectation, not enforced.',
    'Rates are per session. Sessions from the same actor are not independent; the actor count is shown so you can judge how much that matters.',
    'Wilson 95% intervals are given for reach rates; with small n they are wide on purpose.',
  ];
  if (synthetic !== 'real') notes.push('Includes synthetic traffic. Do not publish this table.');
  return { experiment: def, range, synthetic, arms, notes, generated_at: Date.now(), seed_version: cat.version };
}

function countSessionsWith(db: Db, ids: string[], cond: string, ...args: unknown[]): number {
  let n = 0;
  for (const chunk of chunks(ids, 400)) {
    const placeholders = chunk.map(() => '?').join(',');
    n += db.get<{ n: number }>(`SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE session_id IN (${placeholders}) AND ${cond}`, ...chunk, ...args)?.n ?? 0;
  }
  return n;
}

function timesToPage(db: Db, ids: string[], page: string): number[] {
  const out: number[] = [];
  for (const chunk of chunks(ids, 400)) {
    const placeholders = chunk.map(() => '?').join(',');
    for (const r of db.all<{ dt: number }>(`SELECT pd.ts - s.started_at AS dt FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.session_id IN (${placeholders}) AND pd.page_id = ?`, ...chunk, page)) out.push(r.dt);
  }
  return out;
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (!n) return null;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [round(Math.max(0, (centre - half) / denom)), round(Math.min(1, (centre + half) / denom))];
}
