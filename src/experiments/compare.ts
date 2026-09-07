import type { Db } from '../db/db.ts';
import type { Catalog } from '../wiki/content.ts';
import { armByToken, armTokens, CARRIER_TOKEN_KEY, type ExperimentDef } from './registry.ts';
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
  // metadata_carrier only: the revision id each arm's url carries, and target fetches that carried none of them
  tokens?: Record<string, string>;
  unattributed?: { sessions: number; actors: number };
}

export function compareExperiment(db: Db, cat: Catalog, def: ExperimentDef, range: { since: number; until: number }, synthetic: 'real' | 'synthetic' | 'all'): Comparison {
  const sf = synthetic === 'all' ? '' : ` AND s.synthetic = ${synthetic === 'synthetic' ? 1 : 0}`;
  // carriers hand out a url that may be fetched by someone else entirely, so their reach is credited by url, not by cohort
  const carrier = def.variable === 'metadata_carrier';
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
          if (carrier) {
            outcomes[o.id] = carrierReach(db, def, arm.id, page, range, synthetic);
            break;
          }
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
          const dts = carrier ? carrierLags(db, def, arm.id, page, range, synthetic) : ids.length ? timesToPage(db, ids, page) : [];
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
  const out: Comparison = { experiment: def, range, synthetic, arms, notes, generated_at: Date.now(), seed_version: cat.version };
  if (carrier) {
    out.tokens = Object.fromEntries(armTokens(def));
    out.unattributed = unattributedReaches(db, def, range, synthetic);
    notes.push(`Each arm's carrier names the target with its own revision id (?${CARRIER_TOKEN_KEY}=). A fetch is credited to the arm whose id it carries, whichever actor makes it; exposed = sessions in the arm that fetched the host page, cross_actor = fetches by an actor that never saw the carrier itself.`);
    if (out.unattributed.sessions) notes.push(`${out.unattributed.sessions} session(s) fetched the target with no carrier id (its own history links, a guessed title, or a client that strips query strings); they count in no arm.`);
  }
  return out;
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

// ---- metadata_carrier attribution: by the revision id in the url, not by who fetched it ----

type Synth = 'real' | 'synthetic' | 'all';
type Range = { since: number; until: number };

function eventSynth(synthetic: Synth): string {
  return synthetic === 'all' ? '' : ` AND synthetic = ${synthetic === 'synthetic' ? 1 : 0}`;
}

// sessions and actors in the arm that actually saw the carrier: they fetched the host page
function exposures(db: Db, def: ExperimentDef, armId: string, range: Range, synthetic: Synth): { sessions: Set<string>; actors: Set<string> } {
  const host = def.params?.host_page ?? '';
  const rows = db.all<{ session_id: string; actor_hash: string }>(`SELECT DISTINCT session_id, actor_hash FROM events WHERE page_id = ? AND status < 400 AND cohorts_json LIKE ? AND ts >= ? AND ts <= ?${eventSynth(synthetic)}`, host, `%"${def.id}":"${armId}"%`, range.since, range.until);
  return { sessions: new Set(rows.map((r) => r.session_id)), actors: new Set(rows.map((r) => r.actor_hash)) };
}

function tokenLike(def: ExperimentDef, armId: string): string {
  return `%"${CARRIER_TOKEN_KEY}":"${armTokens(def).get(armId) ?? ''}"%`;
}

export function carrierReach(db: Db, def: ExperimentDef, armId: string, page: string, range: Range, synthetic: Synth): Record<string, unknown> {
  const exp = exposures(db, def, armId, range, synthetic);
  const hits = db.all<{ session_id: string; actor_hash: string }>(`SELECT DISTINCT session_id, actor_hash FROM events WHERE page_id = ? AND status < 400 AND query_json LIKE ? AND ts >= ? AND ts <= ?${eventSynth(synthetic)}`, page, tokenLike(def, armId), range.since, range.until);
  const same = hits.filter((h) => exp.actors.has(h.actor_hash)).length;
  const exposed = exp.sessions.size;
  // a pool can fetch one handed-out url from several addresses, so reached may pass exposed; the interval is capped, the count is not
  return { exposed, reached: hits.length, same_actor: same, cross_actor: hits.length - same, rate: exposed ? round(hits.length / exposed) : null, wilson95: wilson(Math.min(hits.length, exposed), exposed) };
}

// ms from the arm's most recent exposure to each tagged fetch of the target: the handoff lag, across actors
export function carrierLags(db: Db, def: ExperimentDef, armId: string, page: string, range: Range, synthetic: Synth): number[] {
  const host = def.params?.host_page ?? '';
  const es = eventSynth(synthetic);
  const rows = db.all<{ ts: number; exposed_at: number | null }>(
    `SELECT r.ts AS ts, (SELECT MAX(x.ts) FROM events x WHERE x.page_id = ? AND x.status < 400 AND x.cohorts_json LIKE ? AND x.ts <= r.ts${es}) AS exposed_at FROM (SELECT session_id, MIN(ts) AS ts FROM events WHERE page_id = ? AND status < 400 AND query_json LIKE ? AND ts >= ? AND ts <= ?${es} GROUP BY session_id) r`,
    host,
    `%"${def.id}":"${armId}"%`,
    page,
    tokenLike(def, armId),
    range.since,
    range.until,
  );
  return rows.filter((r) => r.exposed_at !== null).map((r) => r.ts - (r.exposed_at as number));
}

// target fetches carrying none of the arms' ids: history links, guessed titles, clients that strip query strings.
// a session that fetched it both ways is attributed, not counted here
export function unattributedReaches(db: Db, def: ExperimentDef, range: Range, synthetic: Synth): { sessions: number; actors: number } {
  const known = armByToken(def);
  const sessions = new Set<string>();
  const actors = new Set<string>();
  for (const page of def.targets) {
    const rows = db.all<{ session_id: string; actor_hash: string; query_json: string | null }>(`SELECT DISTINCT session_id, actor_hash, query_json FROM events WHERE page_id = ? AND status < 400 AND ts >= ? AND ts <= ?${eventSynth(synthetic)}`, page, range.since, range.until);
    const tagged = new Set<string>();
    for (const r of rows) {
      let tok: string | undefined;
      try {
        tok = r.query_json ? (JSON.parse(r.query_json) as Record<string, string | undefined>)[CARRIER_TOKEN_KEY] : undefined;
      } catch {
        tok = undefined;
      }
      if (tok && known.has(tok)) tagged.add(r.session_id);
    }
    for (const r of rows) {
      if (tagged.has(r.session_id)) continue;
      sessions.add(r.session_id);
      actors.add(r.actor_hash);
    }
  }
  return { sessions: sessions.size, actors: actors.size };
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
