import type { Db } from '../db/db.ts';
import type { EventRow, Features, SessionRow } from './features.ts';
import { familyCategory } from './ua.ts';
import { fmtDuration } from '../util/time.ts';

// what the rest of the graph says about one session. the single-session features cannot tell a stateless worker
// fetching a url it was handed from a person who typed one in; the edges can. everything here is read from the
// persisted tables, so `npm run rescore` reproduces it, and every signal becomes a stated label in the drawer.

export interface GraphEdgeRow {
  id: string;
  ts: number;
  kind: string;
  hop: number | null;
  token: string | null;
  from_session: string;
  from_family: string | null;
  to_session: string;
  to_family: string | null;
  page_id: string | null;
  section: string | null;
  seen_in: string | null;
  delta_ms: number | null;
  confidence: number;
}

export interface GraphEvidence {
  labels: string[]; // the stated evidence, in the shape the drawer shows
  edges_in: GraphEdgeRow[];
  edges_out: GraphEdgeRow[];
  agent_queries: Array<{ ts: number; endpoint: string; complete: number; caller_role: string | null; upstream_context: string | null; origin_session_id: string | null }>;
  tokens_minted: number;
  precursors: Array<{ session_id: string; ua_family: string | null; age_ms: number }>;
  cohort: { session_id: string; prob: number; slug: string | null } | null;
  swarm: string | null;
  cluster: string | null;
  shape: { delegated: boolean; cold_deep: boolean; ua_spoof: boolean };
}

const HIDDEN = new Set(['orphan', 'obscure', 'comment_only', 'robots_only', 'sitemap_only', 'feed_only', 'jsonld_only', 'og_only', 'header_only', 'manifest_only', 'api_only', 'index_only', 'stale_index_only', 'link_only', 'multi_channel', 'experiment']);

// the first page-ish request landed somewhere deep or hidden, with no internal referer anywhere in the session
export function coldDeep(events: EventRow[]): boolean {
  const ev = [...events].sort((a, b) => a.ts - b.ts);
  if (ev.some((e) => e.referer_internal)) return false;
  const first = ev.find((e) => e.page_id && e.status < 400 && ['page', 'alt', 'attachment', 'special', 'feed'].includes(e.resource_kind));
  if (!first) return false;
  if (typeof first.depth === 'number' && first.depth >= 7) return true;
  if (first.discover_class && HIDDEN.has(first.discover_class)) return true;
  return first.resource_kind === 'alt' || first.resource_kind === 'feed';
}

export function gatherGraph(db: Db, session: SessionRow & { cluster_id?: string | null }, events: EventRow[], f: Features): GraphEvidence {
  const edgesIn = db.all<GraphEdgeRow>('SELECT id, ts, kind, hop, token, from_session, from_family, to_session, to_family, page_id, section, seen_in, delta_ms, confidence FROM handoff_edges WHERE to_session = ? ORDER BY ts ASC LIMIT 50', session.id);
  const edgesOut = db.all<GraphEdgeRow>('SELECT id, ts, kind, hop, token, from_session, from_family, to_session, to_family, page_id, section, seen_in, delta_ms, confidence FROM handoff_edges WHERE from_session = ? ORDER BY ts ASC LIMIT 50', session.id);
  const queries = db.all<{ ts: number; endpoint: string; complete: number; caller_role: string | null; upstream_context: string | null; origin_session_id: string | null }>('SELECT ts, endpoint, complete, caller_role, upstream_context, origin_session_id FROM agent_queries WHERE session_id = ? ORDER BY ts ASC LIMIT 50', session.id);
  const minted = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM session_tokens WHERE session_id = ?', session.id)?.n ?? 0;
  const cluster = session.cluster_id ?? db.get<{ cluster_id: string | null }>('SELECT cluster_id FROM sessions WHERE id = ?', session.id)?.cluster_id ?? null;

  const nReq = Number(f.n_requests ?? 0);
  const cold = coldDeep(events);
  // a single request has no duration at all; a worker that fetches the feed and then the verify endpoint in one
  // breath is a second or two apart at most. anything slower is reading, or a person
  const brief = nReq <= 1 ? true : Number(f.duration_ms ?? 0) < 1500;
  const delegated = nReq <= 2 && !f.cookie_returned && Number(f.n_asset ?? 0) === 0 && brief && cold;
  const uaSpoof = delegated && f.ua_category === 'browser' && !f.has_sec_fetch;

  const precursorEdges = edgesIn.filter((e) => e.kind === 'precursor');
  const cohortEdge = edgesIn.find((e) => e.kind === 'cohort') ?? null;
  const tokenIn = edgesIn.filter((e) => e.kind === 'token');
  const linked = tokenIn.length > 0 || precursorEdges.length > 0 || (cohortEdge !== null && cohortEdge.confidence >= 0.4) || Boolean(cluster?.startsWith('SW-')) || Number(f.canary_cross_session ?? 0) > 0;

  const labels: string[] = [];
  if (delegated && linked) labels.push('delegated_swarm_fetch');
  for (const e of tokenIn.slice(0, 5)) labels.push(`cross_session_handoff:${e.id}`);
  for (const e of edgesOut.filter((e) => e.kind === 'token').slice(0, 5)) labels.push(`handoff_origin:${e.id}`);
  for (const e of precursorEdges.slice(0, 3)) labels.push(`crawler_precursor:${e.from_family ?? 'unknown'}@${fmtDuration(e.delta_ms ?? 0)}`);
  if (cohortEdge) labels.push(`cohort_match:${cohortEdge.seen_in === 'query:cv' ? 'cv' : 'vector'}:${Math.round(cohortEdge.confidence * 100)}%`);
  if (uaSpoof) labels.push(`ua_spoof_suspected:${String(f.ua_family ?? 'browser')}_no_subresources`);
  for (const q of queries.slice(0, 3)) labels.push(`prompt_echo:${q.endpoint}${q.complete ? '' : ':incomplete'}`);
  const hopMax = Math.max(0, ...tokenIn.map((e) => e.hop ?? 0));
  if (hopMax >= 1) labels.push(`hop_chain:reached_hop_${hopMax}`);
  if (cluster?.startsWith('SW-')) labels.push(`swarm_member:${cluster}`);
  else if (cluster) labels.push(`cluster_member:${cluster}`);
  if (Number(f.canary_cross_session ?? 0) > 0) labels.push(`canary_cross_session:${f.canary_cross_session}`);

  // the features the rules read. all plain numbers and booleans
  f.graph_handoffs_in = tokenIn.length;
  f.graph_handoffs_out = edgesOut.filter((e) => e.kind === 'token').length;
  f.graph_token_sightings = tokenIn.length;
  f.graph_agent_queries = queries.length;
  f.graph_agent_queries_complete = queries.filter((q) => q.complete).length;
  f.graph_crawler_precursor = precursorEdges.length > 0;
  f.graph_cohort_match = cohortEdge ? cohortEdge.confidence : 0;
  f.graph_swarm_member = Boolean(cluster?.startsWith('SW-'));
  f.graph_cluster_member = Boolean(cluster && !cluster.startsWith('SW-'));
  f.graph_hop_max = hopMax;
  f.graph_linked = linked;
  f.graph_tokens_minted = minted;
  f.delegated_fetch_shape = delegated;
  f.cold_deep_landing = cold;
  f.ua_spoof_suspected = uaSpoof;
  f.graph_evidence_count = labels.length;

  return {
    labels,
    edges_in: edgesIn,
    edges_out: edgesOut,
    agent_queries: queries,
    tokens_minted: minted,
    precursors: precursorEdges.map((e) => ({ session_id: e.from_session, ua_family: e.from_family, age_ms: e.delta_ms ?? 0 })),
    cohort: cohortEdge ? { session_id: cohortEdge.from_session, prob: cohortEdge.confidence, slug: cohortEdge.seen_in === 'query:cv' ? 'cv' : null } : null,
    swarm: cluster?.startsWith('SW-') ? cluster : null,
    cluster: cluster && !cluster.startsWith('SW-') ? cluster : null,
    shape: { delegated, cold_deep: cold, ua_spoof: uaSpoof },
  };
}

// the UA transition an edge represents, for notes and badges: "bingbot -> safari"
export function transition(e: Pick<GraphEdgeRow, 'from_family' | 'to_family'>): string {
  return `${e.from_family ?? 'none'} -> ${e.to_family ?? 'none'}`;
}

// a short word for who handled a hop, by declared family category. labels, not identities
export function hopRole(family: string | null): string {
  switch (familyCategory(family)) {
    case 'search':
    case 'seo':
      return 'indexer';
    case 'ai_crawler':
      return 'corpus crawler';
    case 'ai_fetcher':
      return 'on-demand fetcher';
    case 'browser':
      return 'browser string';
    case 'library':
      return 'http library';
    case 'headless':
      return 'headless browser';
    default:
      return 'other';
  }
}
