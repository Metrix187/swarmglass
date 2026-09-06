import { createHash } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { Catalog } from '../wiki/content.ts';
import type { ExperimentDef } from './registry.ts';
import { compareExperiment, type Comparison } from './compare.ts';
import { sanitizeSession, sanitizeEvents, assertNoLeak, type Level } from '../publish/sanitize.ts';

// a downloadable, reproducible result bundle: definition + comparison + sanitized rows + provenance.

export interface Bundle {
  bundle_version: 1;
  generated_at: string;
  swarmglass_version: string;
  seed_version: string;
  heuristics_version: number;
  level: Level;
  experiment: ExperimentDef;
  comparison: Comparison;
  sessions: Record<string, unknown>[];
  events_sample: Record<string, unknown>[];
  provenance: { db_rows: { sessions: number; events: number }; range: { since: string; until: string }; synthetic: string };
  sha256: string;
}

export function bundleExperiment(db: Db, cat: Catalog, def: ExperimentDef, range: { since: number; until: number }, synthetic: 'real' | 'synthetic' | 'all', level: Level, heuristicsVersion: number, appVersion: string): Bundle {
  const comparison = compareExperiment(db, cat, def, range, synthetic);
  const sf = synthetic === 'all' ? '' : ` AND synthetic = ${synthetic === 'synthetic' ? 1 : 0}`;
  const rows = db.all<Record<string, unknown>>(`SELECT * FROM sessions WHERE cohorts_json LIKE ? AND started_at >= ? AND started_at <= ?${sf} ORDER BY started_at LIMIT 5000`, `%"${def.id}":%`, range.since, range.until);
  const keyed = new Map<string, string>();
  const sessions = rows.map((r, i) => sanitizeSession(decode(r), level, keyed, i));
  const ids = rows.map((r) => String(r.id)).slice(0, 200);
  const events: Record<string, unknown>[] = [];
  for (const id of ids) {
    for (const e of db.all<Record<string, unknown>>('SELECT * FROM events WHERE session_id = ? ORDER BY ts LIMIT 300', id)) events.push(e);
  }
  const eventsSample = sanitizeEvents(events, level, keyed);
  const body = {
    bundle_version: 1 as const,
    generated_at: new Date().toISOString(),
    swarmglass_version: appVersion,
    seed_version: cat.version,
    heuristics_version: heuristicsVersion,
    level,
    experiment: def,
    comparison,
    sessions,
    events_sample: eventsSample,
    provenance: { db_rows: { sessions: rows.length, events: events.length }, range: { since: new Date(range.since).toISOString(), until: new Date(range.until).toISOString() }, synthetic },
  };
  const serialized = JSON.stringify(body);
  if (level === 'public') assertNoLeak(serialized);
  return { ...body, sha256: createHash('sha256').update(serialized).digest('hex') };
}

function decode(r: Record<string, unknown>): Record<string, unknown> {
  const out = { ...r };
  for (const k of ['cohorts_json', 'features_json', 'scores_json']) {
    if (typeof out[k] === 'string') {
      try {
        out[k.replace('_json', '')] = JSON.parse(out[k] as string);
      } catch {
        out[k.replace('_json', '')] = null;
      }
    }
    delete out[k];
  }
  return out;
}
