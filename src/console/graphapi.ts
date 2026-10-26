import type { Db } from '../db/db.ts';
import { median } from '../util/time.ts';
import { hopRole, transition, type GraphEdgeRow } from '../telemetry/graph.ts';

// read side of the session graph: directed edges, breadcrumb chains, prompt-echo captures, token stats. everything
// here is a plain row from 004_swarm_graph.sql dressed for the console; nothing is re-derived from events.

export interface Range {
  since: number;
  until: number;
}

type Synth = 'real' | 'synthetic' | 'all';

function sf(synthetic: Synth, col = 'synthetic'): { sql: string; args: unknown[] } {
  if (synthetic === 'all') return { sql: '', args: [] };
  return { sql: ` AND ${col} = ?`, args: [synthetic === 'synthetic' ? 1 : 0] };
}

export interface EdgeView extends GraphEdgeRow {
  from_actor: string | null;
  to_actor: string | null;
  target_path: string | null;
  from_class: string | null;
  to_class: string | null;
  transition: string;
  candidates: unknown | null;
}

function classesFor(db: Db, ids: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    for (const r of db.all<{ id: string; likely_class: string | null }>(`SELECT id, likely_class FROM sessions WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk)) out.set(r.id, r.likely_class);
  }
  return out;
}

function dress(db: Db, rows: Array<GraphEdgeRow & { from_actor: string | null; to_actor: string | null; target_path: string | null; candidates_json: string | null }>): EdgeView[] {
  const cls = classesFor(db, [...new Set(rows.flatMap((r) => [r.from_session, r.to_session]))]);
  return rows.map((r) => ({
    ...r,
    candidates_json: undefined,
    candidates: r.candidates_json ? safeJson(r.candidates_json) : null,
    from_class: cls.get(r.from_session) ?? null,
    to_class: cls.get(r.to_session) ?? null,
    transition: transition(r),
  })) as EdgeView[];
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const EDGE_COLS = 'id, ts, kind, hop, token, from_session, from_actor, from_family, to_session, to_actor, to_family, page_id, section, target_path, seen_in, delta_ms, confidence, candidates_json';

export function recentEdges(db: Db, range: Range, synthetic: Synth, limit = 120): EdgeView[] {
  const f = sf(synthetic);
  return dress(db, db.all(`SELECT ${EDGE_COLS} FROM handoff_edges WHERE ts >= ? AND ts <= ?${f.sql} ORDER BY ts DESC LIMIT ?`, range.since, range.until, ...f.args, limit));
}

export function edgesFor(db: Db, sessionId: string): { edges_in: EdgeView[]; edges_out: EdgeView[] } {
  return {
    edges_in: dress(db, db.all(`SELECT ${EDGE_COLS} FROM handoff_edges WHERE to_session = ? ORDER BY ts ASC LIMIT 100`, sessionId)),
    edges_out: dress(db, db.all(`SELECT ${EDGE_COLS} FROM handoff_edges WHERE from_session = ? ORDER BY ts ASC LIMIT 100`, sessionId)),
  };
}

export function edgeTotals(db: Db, range: Range, synthetic: Synth): Record<string, number> {
  const f = sf(synthetic);
  const out: Record<string, number> = { token: 0, cohort: 0, precursor: 0 };
  for (const r of db.all<{ kind: string; n: number }>(`SELECT kind, COUNT(*) AS n FROM handoff_edges WHERE ts >= ? AND ts <= ?${f.sql} GROUP BY kind`, range.since, range.until, ...f.args)) out[r.kind] = r.n;
  return out;
}

export interface ChainHop {
  hop: number;
  edge_id: string;
  ts: number;
  from_session: string;
  to_session: string;
  from_family: string | null;
  to_family: string | null;
  from_role: string;
  to_role: string;
  from_class: string | null;
  to_class: string | null;
  page_id: string | null;
  section: string | null;
  lag_ms: number | null; // since the token was minted
  gap_ms: number | null; // since the previous hop in the chain
}

export interface Chain {
  id: string;
  hops: ChainHop[];
  complete: boolean; // reached the verify endpoint (hop 3)
  total_ms: number;
  roles: string; // "indexer → corpus crawler → browser string"
  families: string;
  first: number;
  last: number;
}

// walk the token edges: a hop-1 edge A->B, then a hop-2 edge leaving B, then a hop-3 edge leaving that one.
// chains that start at hop 2 or 3 are kept too, they are partial chains, and the view says so
export function chains(db: Db, range: Range, synthetic: Synth, limit = 60): Chain[] {
  const f = sf(synthetic);
  const rows = dress(db, db.all(`SELECT ${EDGE_COLS} FROM handoff_edges WHERE kind = 'token' AND hop >= 1 AND ts >= ? AND ts <= ?${f.sql} ORDER BY ts ASC LIMIT 5000`, range.since - 72 * 3_600_000, range.until, ...f.args));
  const byFrom = new Map<string, EdgeView[]>();
  for (const e of rows) {
    const list = byFrom.get(e.from_session);
    if (list) list.push(e);
    else byFrom.set(e.from_session, [e]);
  }
  const used = new Set<string>();
  const out: Chain[] = [];
  const toHop = (e: EdgeView, prev: EdgeView | null): ChainHop => ({ hop: e.hop ?? 0, edge_id: e.id, ts: e.ts, from_session: e.from_session, to_session: e.to_session, from_family: e.from_family, to_family: e.to_family, from_role: hopRole(e.from_family), to_role: hopRole(e.to_family), from_class: e.from_class, to_class: e.to_class, page_id: e.page_id, section: e.section, lag_ms: e.delta_ms, gap_ms: prev ? e.ts - prev.ts : null });
  for (const start of rows) {
    if (used.has(start.id)) continue;
    const hops: EdgeView[] = [start];
    let cur = start;
    for (;;) {
      const next = (byFrom.get(cur.to_session) ?? []).find((e) => !used.has(e.id) && (e.hop ?? 0) > (cur.hop ?? 0) && e.ts >= cur.ts);
      if (!next) break;
      hops.push(next);
      cur = next;
    }
    for (const e of hops) used.add(e.id);
    if (hops.some((e) => e.ts >= range.since)) {
      const last = hops[hops.length - 1] as EdgeView;
      const roles = [hopRole(start.from_family), ...hops.map((e) => hopRole(e.to_family))];
      const fams = [start.from_family ?? 'none', ...hops.map((e) => e.to_family ?? 'none')];
      out.push({ id: start.id, hops: hops.map((e, i) => toHop(e, hops[i - 1] ?? null)), complete: (last.hop ?? 0) >= 3, total_ms: last.ts - start.ts + (start.delta_ms ?? 0), roles: roles.join(' → '), families: fams.join(' → '), first: start.ts - (start.delta_ms ?? 0), last: last.ts });
    }
  }
  return out.sort((a, b) => b.last - a.last).slice(0, limit);
}

export function chainMotifs(list: Chain[]): Array<{ sequence: string; families: string; chains: number; complete: number; median_total_ms: number | null }> {
  const m = new Map<string, { families: Set<string>; totals: number[]; complete: number }>();
  for (const c of list) {
    const cur = m.get(c.roles) ?? { families: new Set<string>(), totals: [], complete: 0 };
    cur.families.add(c.families);
    cur.totals.push(c.total_ms);
    if (c.complete) cur.complete++;
    m.set(c.roles, cur);
  }
  return [...m.entries()].map(([sequence, v]) => ({ sequence, families: [...v.families].slice(0, 3).join(' | '), chains: v.totals.length, complete: v.complete, median_total_ms: v.totals.length ? median(v.totals) : null })).sort((a, b) => b.chains - a.chains);
}

export interface ScratchpadRow {
  id: number;
  ts: number;
  session_id: string;
  endpoint: string;
  method: string;
  complete: number;
  status: number;
  query_text: string | null;
  caller_role: string | null;
  upstream_context: string | null;
  verification_token: string | null;
  origin_session_id: string | null;
  token_issued: string | null;
  params: Record<string, string> | null;
  body_text: string | null;
  headers: unknown | null;
  ua_family: string | null;
  likely_class: string | null;
  origin_family: string | null;
}

export function scratchpads(db: Db, range: Range, synthetic: Synth, limit = 100, sessionId: string | null = null): ScratchpadRow[] {
  const f = sf(synthetic, 'q.synthetic');
  const where = sessionId ? 'q.session_id = ?' : `q.ts >= ? AND q.ts <= ?${f.sql}`;
  const args = sessionId ? [sessionId] : [range.since, range.until, ...f.args];
  const rows = db.all<Record<string, unknown>>(`SELECT q.*, s.ua_family, s.likely_class, (SELECT ua_family FROM sessions o WHERE o.id = q.origin_session_id) AS origin_family FROM agent_queries q LEFT JOIN sessions s ON s.id = q.session_id WHERE ${where} ORDER BY q.ts DESC LIMIT ?`, ...args, limit);
  return rows.map((r) => ({
    id: Number(r.id),
    ts: Number(r.ts),
    session_id: String(r.session_id),
    endpoint: String(r.endpoint),
    method: String(r.method),
    complete: Number(r.complete),
    status: Number(r.status),
    query_text: (r.query_text as string | null) ?? null,
    caller_role: (r.caller_role as string | null) ?? null,
    upstream_context: (r.upstream_context as string | null) ?? null,
    verification_token: (r.verification_token as string | null) ?? null,
    origin_session_id: (r.origin_session_id as string | null) ?? null,
    token_issued: (r.token_issued as string | null) ?? null,
    params: r.params_json ? (safeJson(String(r.params_json)) as Record<string, string> | null) : null,
    body_text: (r.body_text as string | null) ?? null,
    headers: r.headers_json ? safeJson(String(r.headers_json)) : null,
    ua_family: (r.ua_family as string | null) ?? null,
    likely_class: (r.likely_class as string | null) ?? null,
    origin_family: (r.origin_family as string | null) ?? null,
  }));
}

export function scratchpadTotals(db: Db, range: Range, synthetic: Synth): Record<string, unknown> {
  const f = sf(synthetic);
  const t = db.get<{ n: number; complete: number; sessions: number; with_origin: number }>(`SELECT COUNT(*) AS n, SUM(complete) AS complete, COUNT(DISTINCT session_id) AS sessions, SUM(CASE WHEN origin_session_id IS NOT NULL THEN 1 ELSE 0 END) AS with_origin FROM agent_queries WHERE ts >= ? AND ts <= ?${f.sql}`, range.since, range.until, ...f.args);
  const byEndpoint = Object.fromEntries(db.all<{ endpoint: string; n: number }>(`SELECT endpoint, COUNT(*) AS n FROM agent_queries WHERE ts >= ? AND ts <= ?${f.sql} GROUP BY endpoint`, range.since, range.until, ...f.args).map((r) => [r.endpoint, r.n]));
  const roles = db.all<{ caller_role: string; n: number }>(`SELECT caller_role, COUNT(*) AS n FROM agent_queries WHERE ts >= ? AND ts <= ? AND caller_role IS NOT NULL${f.sql} GROUP BY caller_role ORDER BY n DESC LIMIT 12`, range.since, range.until, ...f.args);
  return { captures: t?.n ?? 0, complete: t?.complete ?? 0, sessions: t?.sessions ?? 0, with_upstream_token: t?.with_origin ?? 0, by_endpoint: byEndpoint, roles };
}

export function tokenStats(db: Db, range: Range, synthetic: Synth): Record<string, unknown> {
  const f = sf(synthetic);
  const minted = db.get<{ n: number; sessions: number }>(`SELECT COUNT(*) AS n, COUNT(DISTINCT session_id) AS sessions FROM session_tokens WHERE issued_at >= ? AND issued_at <= ?${f.sql}`, range.since, range.until, ...f.args);
  const bySection = db.all<{ section: string; hop: number; n: number }>(`SELECT section, hop, COUNT(*) AS n FROM session_tokens WHERE issued_at >= ? AND issued_at <= ?${f.sql} GROUP BY section, hop ORDER BY hop, section`, range.since, range.until, ...f.args);
  const presented = db.get<{ n: number; xa: number; sessions: number }>(`SELECT COUNT(*) AS n, SUM(CASE WHEN from_actor != to_actor THEN 1 ELSE 0 END) AS xa, COUNT(DISTINCT to_session) AS sessions FROM handoff_edges WHERE kind = 'token' AND ts >= ? AND ts <= ?${f.sql}`, range.since, range.until, ...f.args);
  const byHop = db.all<{ hop: number; n: number; lag: number }>(`SELECT hop, COUNT(*) AS n, AVG(delta_ms) AS lag FROM handoff_edges WHERE kind = 'token' AND ts >= ? AND ts <= ?${f.sql} GROUP BY hop ORDER BY hop`, range.since, range.until, ...f.args);
  const transitions = db.all<{ t: string; n: number }>(`SELECT COALESCE(from_family, 'none') || ' -> ' || COALESCE(to_family, 'none') AS t, COUNT(*) AS n FROM handoff_edges WHERE kind = 'token' AND ts >= ? AND ts <= ?${f.sql} GROUP BY t ORDER BY n DESC LIMIT 12`, range.since, range.until, ...f.args);
  return { minted: minted?.n ?? 0, minted_sessions: minted?.sessions ?? 0, by_section: bySection, presented_cross_session: presented?.n ?? 0, presented_cross_actor: presented?.xa ?? 0, presenting_sessions: presented?.sessions ?? 0, by_hop: byHop.map((r) => ({ hop: r.hop, n: r.n, mean_lag_ms: r.lag })), transitions };
}

export function tokensMinted(db: Db, sessionId: string): Array<Record<string, unknown>> {
  return db.all('SELECT token, page_id, section, hop, cohort_slug, issued_at, issue_count, (SELECT COUNT(*) FROM handoff_edges e WHERE e.token = session_tokens.token) AS presented_by_others FROM session_tokens WHERE session_id = ? ORDER BY issued_at ASC LIMIT 100', sessionId);
}

// a one-line summary for the sessions table badge column
export function graphSummary(graphJson: unknown): Record<string, unknown> | null {
  if (!graphJson || typeof graphJson !== 'object') return null;
  const g = graphJson as { labels?: string[]; edges_in?: unknown[]; edges_out?: unknown[]; agent_queries?: unknown[]; swarm?: string | null; shape?: { delegated?: boolean } };
  return { labels: (g.labels ?? []).slice(0, 4), in: (g.edges_in ?? []).length, out: (g.edges_out ?? []).length, queries: (g.agent_queries ?? []).length, swarm: g.swarm ?? null, delegated: Boolean(g.shape?.delegated) };
}
