import type { Db } from '../db/db.ts';
import { median } from '../util/time.ts';
import { shortHash } from '../util/hash.ts';
import type { ClusterResult, Signal } from './cluster.ts';

// a swarm, for our purposes: one exact client signature spread across many network prefixes, most of
// them making a single request and none of them rendering anything. pairwise clustering never sees it,
// two one-request sessions have nothing in common but the user-agent, so this groups by ua_hash over a
// longer window instead. found by hand on 2026-09-06: 96 sessions, 86 prefixes, one six-year-old iphone
// string, six new addresses an hour all day. see docs/findings/F-001.

export interface SwarmSession {
  id: string;
  started_at: number;
  last_seen_at: number;
  ip_trunc: string | null;
  ua_hash: string | null;
  ua_family: string | null;
  ua: string | null;
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
  asset_share: number;
  conditional_share: number;
  pages: number;
  first_seen: number;
  last_seen: number;
  median_start_gap_ms: number;
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
  const groups = new Map<string, SwarmSession[]>();
  for (const s of sessions) {
    if (!s.ua_hash) continue;
    const key = `${s.synthetic ? 'syn' : 'real'}:${s.ua_hash}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const out: Swarm[] = [];
  for (const members of groups.values()) {
    if (members.length < SWARM_MIN_SESSIONS) continue;
    const prefixes = new Set(members.map((m) => m.ip_trunc).filter((p): p is string => Boolean(p)));
    if (prefixes.size < SWARM_MIN_PREFIXES) continue;
    const prefixes16 = new Set([...prefixes].map(widePrefix)).size;
    // a pool, not a couple of nats: most sessions have to come from somewhere new. a fleet that grows its
    // traffic faster than it rents addresses fails that even while obviously being a fleet, which is how
    // amazonbot dropped off the radar at 1620 sessions over 419 prefixes. so let a pool that is scattered
    // wide enough in on the spread alone, and keep the ratio for everyone below that
    if (prefixes.size / members.length < 0.5 && prefixes16 < SWARM_WIDE_BLOCKS) continue;
    const single = members.filter((m) => m.n_requests <= 2).length / members.length;
    if (single < 0.6) continue;
    const requests = members.reduce((a, m) => a + m.n_requests, 0);
    const assets = members.reduce((a, m) => a + m.n_subresources, 0);
    const assetShare = requests ? assets / requests : 0;
    const conditional = members.reduce((a, m) => a + m.n_conditional, 0);
    // real phones fetch the stylesheet. this is the line between "many people once" and "one thing, many masks"
    if (assetShare > 0.05) continue;

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

    const signals: Signal[] = [
      { signal: 'many_prefixes_one_client', strength: Math.min(1, prefixes.size / 24), note: `${prefixes.size} network prefixes across ${prefixes16} wider blocks share one exact user-agent` },
      { signal: 'one_hit_per_address', strength: single, note: `${Math.round(single * 100)}% of sessions made one or two requests` },
      { signal: 'never_rendered', strength: 1 - assetShare / 0.05, note: assets ? `${assets} asset fetches in ${requests} requests` : 'no member ever fetched a stylesheet, script or favicon' },
    ];
    const spanH = (last - first) / 3_600_000;
    if (members.length >= 20 && spanH >= 3) signals.push({ signal: 'sustained_trickle', strength: Math.min(1, spanH / 24), note: `spread over ${spanH.toFixed(1)}h, a new address every ${fmtGap(median(gaps))} at the median` });
    if (union.size >= 12 && touched > 0 && union.size / touched > 0.7) signals.push({ signal: 'partitioned_coverage', strength: Math.min(1, union.size / 40), note: `${members.length} sessions touched ${union.size} pages with almost no overlap: the site divided up one page per address` });

    const raw = signals.reduce((a, s) => a + s.strength, 0);
    const synthetic = members.every((m) => m.synthetic);
    out.push({
      // stable across runs so links in notes keep working: same client, same first day, same id
      id: 'SW-' + shortHash(`${synthetic ? 'syn' : 'real'}:${lead.ua_hash}:${Math.floor(first / 86_400_000)}`, 6).toUpperCase(),
      members: members.map((m) => m.id),
      window_start: first,
      window_end: last,
      signals,
      swarm_score: Math.round(Math.min(1, raw / 3) * 1000) / 1000,
      label: 'distributed swarm: one client signature, one hit per address',
      synthetic,
      summary: {
        ua_family: lead.ua_family ?? 'none',
        ua_sample: (lead.ua ?? '').slice(0, 160),
        sessions: members.length,
        requests,
        prefixes: prefixes.size,
        prefixes16,
        single_hit_share: Math.round(single * 100) / 100,
        asset_share: Math.round(assetShare * 1000) / 1000,
        conditional_share: requests ? Math.round((conditional / requests) * 1000) / 1000 : 0,
        pages: union.size,
        first_seen: first,
        last_seen: last,
        median_start_gap_ms: gaps.length ? median(gaps) : 0,
      },
    });
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

function fmtGap(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)}min` : `${Math.round(ms / 1000)}s`;
}

export function loadSwarmSessions(db: Db, sinceMs: number, limit = 6000): SwarmSession[] {
  const rows = db.all<{ id: string; started_at: number; last_seen_at: number; ip_trunc: string | null; ua_hash: string | null; ua_family: string | null; ua: string | null; n_requests: number; n_subresources: number; synthetic: number }>(
    'SELECT id, started_at, last_seen_at, ip_trunc, ua_hash, ua_family, ua, n_requests, n_subresources, synthetic FROM sessions WHERE started_at >= ? AND ua_hash IS NOT NULL ORDER BY started_at DESC LIMIT ?',
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
  return rows.map((r) => ({ ...r, synthetic: Boolean(r.synthetic), n_conditional: cond.get(r.id) ?? 0, pages: pages.get(r.id) ?? new Set<string>() }));
}
