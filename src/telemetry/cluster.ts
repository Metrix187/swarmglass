import { cosine, jaccard } from '../util/text.ts';
import { mean, stddev } from '../util/time.ts';
import type { Db } from '../db/db.ts';

// groups sessions that look like they belong together and scores how swarm-like
// the group is. everything here is a heuristic with a stated reason; the console
// shows the reasons next to the score and never calls a cluster "a swarm" outright.

export interface ClusterSession {
  id: string;
  actor_hash: string;
  started_at: number;
  last_seen_at: number;
  ip_trunc: string | null;
  ua_hash: string | null;
  ua_family: string | null;
  pages: Set<string>;
  vector: number[];
  median_gap: number;
  synthetic: boolean;
  cross_actor_sightings: number;
}

export interface Signal {
  signal: string;
  strength: number; // 0..1
  note: string;
}

export interface ClusterResult {
  id: string;
  members: string[];
  window_start: number;
  window_end: number;
  signals: Signal[];
  swarm_score: number;
  label: string;
  synthetic: boolean;
}

const FEATURE_KEYS = ['machine_share', 'bfs_score', 'nav_entropy', 'pacing_regularity', 'hidden_share', 'accept_json_share', 'internal_referer_share', 'asset_share', 'error_rate', 'revisit_rate', 'loop_score', 'topic_coherence'];

export function vectorFromFeatures(f: Record<string, unknown>): number[] {
  return FEATURE_KEYS.map((k) => {
    const v = f[k];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  });
}

export function pairSimilarity(a: ClusterSession, b: ClusterSession): number {
  const pageSim = jaccard(a.pages, b.pages);
  const vecSim = cosine(a.vector, b.vector);
  const uaSame = a.ua_hash && a.ua_hash === b.ua_hash ? 1 : 0;
  const netSame = a.ip_trunc && a.ip_trunc === b.ip_trunc ? 1 : 0;
  const overlap = timeOverlap(a, b) ? 1 : 0;
  const gapSim = a.median_gap && b.median_gap ? 1 - Math.min(1, Math.abs(a.median_gap - b.median_gap) / Math.max(a.median_gap, b.median_gap)) : 0;
  return 0.3 * pageSim + 0.25 * vecSim + 0.15 * uaSame + 0.1 * netSame + 0.1 * overlap + 0.1 * gapSim;
}

function timeOverlap(a: ClusterSession, b: ClusterSession, slackMs = 120_000): boolean {
  return a.started_at <= b.last_seen_at + slackMs && b.started_at <= a.last_seen_at + slackMs;
}

// single-linkage over pairs above threshold. n is capped by the caller.
export function clusterSessions(sessions: ClusterSession[], threshold = 0.62): ClusterResult[] {
  const n = sessions.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sessions[i] as ClusterSession;
      const b = sessions[j] as ClusterSession;
      if (a.synthetic !== b.synthetic) continue; // never mix test traffic with real
      if (a.id === b.id) continue;
      if (pairSimilarity(a, b) >= threshold) union(i, j);
    }
  }
  const groups = new Map<number, ClusterSession[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    (groups.get(r) as ClusterSession[]).push(sessions[i] as ClusterSession);
  }
  const out: ClusterResult[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    out.push(describeCluster(members));
  }
  return out.sort((a, b) => b.swarm_score - a.swarm_score);
}

export function describeCluster(members: ClusterSession[]): ClusterResult {
  const signals: Signal[] = [];
  const nets = new Set(members.map((m) => m.ip_trunc ?? 'unknown'));
  const uas = new Set(members.map((m) => m.ua_hash ?? 'none'));
  const actors = new Set(members.map((m) => m.actor_hash));
  const start = Math.min(...members.map((m) => m.started_at));
  const end = Math.max(...members.map((m) => m.last_seen_at));

  // 1. many networks, one client signature
  if (nets.size >= 3 && uas.size === 1) {
    signals.push({ signal: 'multi_network_same_client', strength: Math.min(1, nets.size / 8), note: `${nets.size} network prefixes share one exact user-agent` });
  }
  // 2. partitioned coverage: low pairwise overlap, high union
  const union = new Set<string>();
  for (const m of members) for (const p of m.pages) union.add(p);
  const pairJ: number[] = [];
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) pairJ.push(jaccard((members[i] as ClusterSession).pages, (members[j] as ClusterSession).pages));
  const meanJ = pairJ.length ? mean(pairJ) : 1;
  const totalPages = members.reduce((acc, m) => acc + m.pages.size, 0);
  if (union.size >= 12 && meanJ < 0.2 && totalPages > 0 && union.size / totalPages > 0.7) {
    signals.push({ signal: 'partitioned_coverage', strength: Math.min(1, (1 - meanJ) * (union.size / 40)), note: `${members.length} sessions cover ${union.size} pages with little overlap — looks divided up` });
  }
  // 3. synchronized starts
  const starts = members.map((m) => m.started_at).sort((a, b) => a - b);
  const startSpread = (starts[starts.length - 1] as number) - (starts[0] as number);
  if (members.length >= 3 && startSpread < 60_000) {
    signals.push({ signal: 'synchronized_start', strength: Math.min(1, 1 - startSpread / 60_000), note: `${members.length} sessions began within ${Math.round(startSpread / 1000)}s` });
  }
  // 4. overlapping in time at all
  let overlaps = 0;
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) if (timeOverlap(members[i] as ClusterSession, members[j] as ClusterSession, 0)) overlaps++;
  if (pairJ.length && overlaps / pairJ.length > 0.5) {
    signals.push({ signal: 'concurrent_activity', strength: overlaps / pairJ.length, note: `${Math.round((100 * overlaps) / pairJ.length)}% of member pairs were active at the same time` });
  }
  // 5. canary transfer between actors
  const xfer = members.reduce((acc, m) => acc + m.cross_actor_sightings, 0);
  if (xfer > 0) {
    signals.push({ signal: 'canary_transfer', strength: Math.min(1, xfer / 3), note: `${xfer} sighting(s) of canaries that were only shown to another member` });
  }
  // 6. pacing similarity
  const gaps = members.map((m) => m.median_gap).filter((g) => g > 0);
  if (gaps.length >= 3) {
    const cv = mean(gaps) > 0 ? stddev(gaps) / mean(gaps) : 1;
    if (cv < 0.25) signals.push({ signal: 'shared_pacing', strength: 1 - cv / 0.25, note: `median request gaps agree within ${Math.round(cv * 100)}%` });
  }
  // 7. one actor, many sessions (persistence rather than swarm; listed for honesty)
  if (actors.size === 1 && members.length >= 3) {
    signals.push({ signal: 'single_actor_repeat', strength: 0.2, note: `all ${members.length} sessions share one actor fingerprint — repeat visitor, not a swarm` });
  }

  const swarmSignals = signals.filter((s) => s.signal !== 'single_actor_repeat');
  const raw = swarmSignals.reduce((acc, s) => acc + s.strength, 0);
  const swarm = Math.min(1, raw / 3);
  let label = 'similar sessions';
  if (swarm >= 0.6) label = 'possible coordinated group';
  else if (swarm >= 0.3) label = 'weak coordination hints';
  if (actors.size === 1) label = 'repeat visitor';
  return {
    id: '',
    members: members.map((m) => m.id),
    window_start: start,
    window_end: end,
    signals,
    swarm_score: Math.round(swarm * 1000) / 1000,
    label,
    synthetic: members.every((m) => m.synthetic),
  };
}

// loads recent scored sessions into the shape the clusterer wants
export function loadClusterSessions(db: Db, sinceMs: number, limit = 2000): ClusterSession[] {
  const rows = db.all<{
    id: string;
    actor_hash: string;
    started_at: number;
    last_seen_at: number;
    ip_trunc: string | null;
    ua_hash: string | null;
    ua_family: string | null;
    features_json: string | null;
    synthetic: number;
  }>('SELECT id, actor_hash, started_at, last_seen_at, ip_trunc, ua_hash, ua_family, features_json, synthetic FROM sessions WHERE started_at >= ? AND features_json IS NOT NULL ORDER BY started_at DESC LIMIT ?', sinceMs, limit);
  const out: ClusterSession[] = [];
  for (const r of rows) {
    let f: Record<string, unknown> = {};
    try {
      f = JSON.parse(r.features_json ?? '{}') as Record<string, unknown>;
    } catch {
      // skip
    }
    const pages = new Set(db.all<{ page_id: string }>('SELECT page_id FROM page_discoveries WHERE session_id = ?', r.id).map((p) => p.page_id));
    const xa = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM canary_sightings WHERE session_id = ? AND cross_actor = 1', r.id)?.n ?? 0;
    out.push({
      id: r.id,
      actor_hash: r.actor_hash,
      started_at: r.started_at,
      last_seen_at: r.last_seen_at,
      ip_trunc: r.ip_trunc,
      ua_hash: r.ua_hash,
      ua_family: r.ua_family,
      pages,
      vector: vectorFromFeatures(f),
      median_gap: typeof f.median_gap_ms === 'number' ? f.median_gap_ms : 0,
      synthetic: Boolean(r.synthetic),
      cross_actor_sightings: xa,
    });
  }
  return out;
}
