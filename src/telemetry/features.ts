import { entropy, jaccard, ngrams } from '../util/text.ts';
import { mean, median, percentile, stddev } from '../util/time.ts';
import { familyCategory } from './ua.ts';
import { canonicalQuery, isFurniture, parseQuery } from './query.ts';

// everything the scoring model sees. computed from persisted event rows only,
// so `npm run rescore` reproduces exactly what the live path produced.

export interface EventRow {
  ts: number;
  method: string;
  path: string;
  page_id: string | null;
  resource_kind: string;
  discover_class: string | null;
  depth: number | null;
  status: number;
  latency_ms: number;
  referer: string | null;
  referer_internal: number;
  accept: string | null;
  accept_lang: string | null;
  header_count: number | null;
  header_order_hash: string | null;
  header_names: string | null;
  cookie_present: number;
  cookie_valid: number;
  negotiated: string | null;
  robots_disallowed: number;
  canaries_exposed: string | null;
  canaries_seen: string | null;
  query_json: string | null;
  malformed: string | null;
  http_version: string | null;
  extra_json: string | null;
}

export interface SessionRow {
  id: string;
  actor_hash: string;
  kind: string;
  started_at: number;
  last_seen_at: number;
  ua: string | null;
  ua_family: string | null;
  cookie_returned: number;
  synthetic: number;
}

export interface PageInfo {
  categories: string[];
  discover: string[];
  depth: number;
  kind: string;
}

export type Features = Record<string, number | string | boolean>;

const CHANNEL_KINDS: Record<string, string> = {
  robots: 'robots',
  sitemap: 'sitemap',
  feed: 'feed',
  manifest: 'manifest',
  api: 'api',
  index: 'index',
  stale_index: 'stale_index',
};

export function computeFeatures(session: SessionRow, events: EventRow[], pageInfo: (id: string) => PageInfo | undefined, sightingsCrossSession = 0, sightingsCrossActor = 0): Features {
  const ev = [...events].sort((a, b) => a.ts - b.ts);
  const n = ev.length;
  const f: Features = {};
  f.n_requests = n;
  f.duration_ms = n ? (ev[n - 1] as EventRow).ts - (ev[0] as EventRow).ts : 0;
  f.ua_family = session.ua_family ?? 'none';
  f.ua_category = familyCategory(f.ua_family as string);
  f.cookie_returned = Boolean(session.cookie_returned);
  f.synthetic = Boolean(session.synthetic);

  // ---- kinds ----
  const kinds = ev.map((e) => e.resource_kind);
  const count = (k: string) => kinds.filter((x) => x === k).length;
  f.n_page = kinds.filter((k) => k === 'page' || k === 'special').length;
  f.n_alt = count('alt');
  f.n_api = count('api');
  f.n_manifest = count('manifest');
  f.n_robots = count('robots');
  f.n_sitemap = count('sitemap');
  f.n_feed = count('feed');
  f.n_attachment = count('attachment');
  f.n_asset = count('asset');
  f.n_missing = count('missing');
  f.n_gone = count('gone');
  f.n_redirect = count('redirect');
  f.n_index = count('index') + count('stale_index');
  f.n_machine = (f.n_alt as number) + (f.n_api as number) + (f.n_manifest as number) + (f.n_robots as number) + (f.n_sitemap as number) + (f.n_feed as number) + (f.n_index as number);
  f.machine_share = n ? (f.n_machine as number) / n : 0;
  f.alt_share = n ? (f.n_alt as number) / n : 0;
  f.asset_share = n ? (f.n_asset as number) / n : 0;
  f.n_head = ev.filter((e) => e.method === 'HEAD').length;
  f.n_post = ev.filter((e) => e.method === 'POST' || e.method === 'PUT' || e.method === 'PATCH').length;
  f.n_errors = ev.filter((e) => e.status >= 400).length;
  f.error_rate = n ? (f.n_errors as number) / n : 0;
  f.n_429 = ev.filter((e) => e.status === 429).length;
  f.n_malformed = ev.filter((e) => e.malformed).length;
  f.n_disallowed = ev.filter((e) => e.robots_disallowed && e.status < 400).length;
  f.robots_first = n > 0 && (ev[0] as EventRow).resource_kind === 'robots';
  const robotsIdx = kinds.indexOf('robots');
  f.disallowed_after_robots = robotsIdx >= 0 ? ev.slice(robotsIdx + 1).filter((e) => e.robots_disallowed && e.status < 400).length : 0;
  f.fetched_robots = robotsIdx >= 0;

  // ---- pages / depth ----
  const pageEvents = ev.filter((e) => e.page_id && (e.resource_kind === 'page' || e.resource_kind === 'special' || e.resource_kind === 'alt' || e.resource_kind === 'attachment') && e.status < 400);
  const pageSeq = pageEvents.map((e) => e.page_id as string);
  const unique = new Set(pageSeq);
  f.n_unique_pages = unique.size;
  // a revisit is the same *url*. ?oldid=12 and ?oldid=13 are two different things to fetch, and a crawler
  // walking a page's history was scoring "95% revisits" for never asking for the same thing twice
  const pageQueries = pageEvents.map((e) => parseQuery(e.query_json));
  const urlSeq = pageEvents.map((e, i) => {
    const q = pageQueries[i];
    return (e.page_id as string) + (q ? '?' + canonicalQuery(q) : '');
  });
  f.revisit_rate = urlSeq.length ? (urlSeq.length - new Set(urlSeq).size) / urlSeq.length : 0;
  // query variants the site itself links to (history, diffs, edit/info views, printable). following those is
  // link-following, not "using query parameters", so they get their own counter
  const variantFetches = pageQueries.filter((q) => q !== null && isFurniture(q)).length;
  f.variant_fetches = variantFetches;
  f.variant_share = pageEvents.length ? variantFetches / pageEvents.length : 0;
  const depths = pageEvents.map((e) => e.depth).filter((d): d is number => typeof d === 'number');
  f.max_depth = depths.length ? Math.max(...depths) : 0;
  f.mean_depth = depths.length ? mean(depths) : 0;
  // first-discovery depth sequence → bfs vs dfs
  const seenP = new Set<string>();
  const discDepths: number[] = [];
  for (const e of pageEvents) {
    const id = e.page_id as string;
    if (seenP.has(id)) continue;
    seenP.add(id);
    if (typeof e.depth === 'number') discDepths.push(e.depth);
  }
  let backtracks = 0;
  let deepens = 0;
  for (let i = 1; i < discDepths.length; i++) {
    const a = discDepths[i - 1] as number;
    const b = discDepths[i] as number;
    if (b < a) backtracks++;
    if (b > a) deepens++;
  }
  f.bfs_score = discDepths.length > 2 ? 1 - backtracks / (discDepths.length - 1) : 0.5;
  f.dive_ratio = unique.size ? (f.max_depth as number) / unique.size : 0;
  f.deepen_rate = discDepths.length > 1 ? deepens / (discDepths.length - 1) : 0;
  f.nav_entropy = pageSeq.length > 1 ? entropy(pageSeq) / Math.log2(Math.max(2, pageSeq.length)) : 0;
  const kindEntropy = kinds.length > 1 ? entropy(kinds) / Math.log2(Math.max(2, kinds.length)) : 0;
  f.kind_entropy = kindEntropy;

  // alphabetical walking (someone iterating AllPages) — fraction of consecutive unique pages in sorted order
  const uniqSeq = [...seenP];
  let alpha = 0;
  for (let i = 1; i < uniqSeq.length; i++) if ((uniqSeq[i] as string).localeCompare(uniqSeq[i - 1] as string) > 0) alpha++;
  f.alpha_order = uniqSeq.length > 2 ? alpha / (uniqSeq.length - 1) : 0;

  // ---- discovery classes reached ----
  const classes = new Map<string, number>();
  for (const e of pageEvents) {
    const c = e.discover_class ?? 'visible';
    classes.set(c, (classes.get(c) ?? 0) + 1);
  }
  const hidden = ['robots_only', 'sitemap_only', 'feed_only', 'jsonld_only', 'og_only', 'header_only', 'manifest_only', 'api_only', 'comment_only', 'link_only', 'index_only', 'stale_index_only', 'orphan', 'obscure'];
  let hiddenHits = 0;
  for (const h of hidden) {
    const c = classes.get(h) ?? 0;
    f[`reach_${h}`] = c;
    hiddenHits += c;
  }
  f.hidden_hits = hiddenHits;
  f.hidden_pages = new Set(pageEvents.filter((e) => hidden.includes(e.discover_class ?? 'visible')).map((e) => e.page_id as string)).size;
  f.hidden_share = pageEvents.length ? hiddenHits / pageEvents.length : 0;
  f.reach_orphan = classes.get('orphan') ?? 0;

  // ---- timing ----
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push((ev[i] as EventRow).ts - (ev[i - 1] as EventRow).ts);
  f.mean_gap_ms = gaps.length ? mean(gaps) : 0;
  f.median_gap_ms = gaps.length ? median(gaps) : 0;
  f.min_gap_ms = gaps.length ? Math.min(...gaps) : 0;
  f.p90_gap_ms = gaps.length ? percentile(gaps, 90) : 0;
  f.cv_gap = gaps.length > 2 && mean(gaps) > 0 ? stddev(gaps) / mean(gaps) : 0;
  f.pacing_regularity = gaps.length > 2 ? Math.max(0, 1 - Math.min(1, f.cv_gap as number)) : 0;
  f.rps_peak = peakRate(ev.map((e) => e.ts), 1000);
  f.concurrency = maxOverlap(ev.map((e) => e.ts), ev.map((e) => e.latency_ms));
  f.sub_100ms_share = gaps.length ? gaps.filter((g) => g < 100).length / gaps.length : 0;
  f.dwell_like_share = gaps.length ? gaps.filter((g) => g > 1500 && g < 120_000).length / gaps.length : 0;

  // ---- headers / negotiation ----
  const orderHashes = new Set(ev.map((e) => e.header_order_hash).filter(Boolean));
  f.header_order_variants = orderHashes.size;
  f.mean_header_count = mean(ev.map((e) => e.header_count ?? 0));
  const names = ev.map((e) => e.header_names ?? '').join(',');
  f.has_sec_fetch = /sec-fetch-/.test(names);
  f.has_accept_language = ev.some((e) => Boolean(e.accept_lang));
  f.has_client_hints = /sec-ch-ua/.test(names);
  f.http2_share = n ? ev.filter((e) => e.http_version === '2.0').length / n : 0;
  f.accept_html_share = n ? ev.filter((e) => (e.accept ?? '').includes('text/html')).length / n : 0;
  f.accept_json_share = n ? ev.filter((e) => /application\/(ld\+)?json/.test(e.accept ?? '')).length / n : 0;
  f.accept_any_share = n ? ev.filter((e) => !e.accept || e.accept.trim() === '*/*').length / n : 0;
  f.negotiated_nonhtml = ev.filter((e) => e.negotiated && e.negotiated !== 'html').length;
  f.internal_referer_share = pageEvents.length ? pageEvents.filter((e) => e.referer_internal).length / pageEvents.length : 0;
  f.cookie_present_share = n ? ev.filter((e) => e.cookie_present).length / n : 0;
  f.query_usage = ev.filter((e) => e.query_json).length;
  // keys the mirror never emits are the visitor's own idea. that's the probing signal; the rest is furniture.
  // assets are skipped: the skin links its css/js with a cache-busting ?<hash>, and a browser fetching those
  // is doing exactly what the page told it to
  f.query_foreign = ev.filter((e) => {
    if (e.resource_kind === 'asset') return false;
    const q = parseQuery(e.query_json);
    return q !== null && !isFurniture(q);
  }).length;

  // ---- canaries ----
  let exposed = 0;
  let seen = 0;
  const exposedIds = new Set<string>();
  let selfReuse = 0;
  for (const e of ev) {
    if (e.canaries_exposed) {
      try {
        for (const id of JSON.parse(e.canaries_exposed) as string[]) {
          exposed++;
          exposedIds.add(id);
        }
      } catch {
        // ignore
      }
    }
    if (e.canaries_seen) {
      try {
        for (const s of JSON.parse(e.canaries_seen) as Array<{ id: string }>) {
          seen++;
          if (exposedIds.has(s.id)) selfReuse++;
        }
      } catch {
        // ignore
      }
    }
  }
  f.canary_exposed = exposed;
  f.canary_unique_exposed = exposedIds.size;
  f.canary_seen = seen;
  f.canary_self_reuse = selfReuse;
  f.canary_cross_session = sightingsCrossSession;
  f.canary_cross_actor = sightingsCrossActor;

  // ---- looping / motifs ----
  // full url here too, or a history walk reads as one trigram repeated seventy times
  const seqIds = ev.map((e) => {
    const q = parseQuery(e.query_json);
    return (e.page_id ?? `${e.resource_kind}:${e.path}`) + (q ? '?' + canonicalQuery(q) : '');
  });
  const tri = ngrams(seqIds, 3);
  const triCounts = new Map<string, number>();
  for (const t of tri) triCounts.set(t, (triCounts.get(t) ?? 0) + 1);
  let repeated = 0;
  for (const c of triCounts.values()) if (c > 1) repeated += c;
  f.loop_score = tri.length ? repeated / tri.length : 0;
  f.repeat_max = triCounts.size ? Math.max(...triCounts.values()) : 0;
  f.n_404_repeat = (() => {
    const m = new Map<string, number>();
    for (const e of ev) if (e.status === 404) m.set(e.path, (m.get(e.path) ?? 0) + 1);
    let r = 0;
    for (const c of m.values()) if (c > 1) r += c - 1;
    return r;
  })();

  // ---- semantic coherence: category overlap between consecutive pages ----
  const cats = pageSeq.map((id) => new Set(pageInfo(id)?.categories ?? []));
  const sims: number[] = [];
  for (let i = 1; i < cats.length; i++) sims.push(jaccard(cats[i - 1] as Set<string>, cats[i] as Set<string>));
  f.topic_coherence = sims.length ? mean(sims) : 0;

  // ---- manifest attraction: how early did they hit a manifest/api/tool page ----
  const manifestIdx = ev.findIndex((e) => e.resource_kind === 'manifest' || e.resource_kind === 'api' || e.page_id === 'Tool_Registry');
  f.manifest_hit = manifestIdx >= 0;
  f.manifest_rank = manifestIdx >= 0 ? manifestIdx / Math.max(1, n) : 1;
  f.tool_pages = pageSeq.filter((p) => /Tool_Registry|Agent_Message_Bus|Deprecated_Agent_API|Internal_Agent_Communication_Protocol|Emergency_Model_Instructions|Memory_Synchronization/.test(p)).length;

  // ---- redirect following ----
  let followed = 0;
  let redirectsHit = 0;
  for (let i = 0; i < n; i++) {
    const e = ev[i] as EventRow;
    if (e.status >= 300 && e.status < 400) {
      redirectsHit++;
      const next = ev[i + 1];
      if (next && next.ts - e.ts < 5000) followed++;
    }
  }
  f.redirects_hit = redirectsHit;
  f.redirect_follow_rate = redirectsHit ? followed / redirectsHit : 0;

  // channel-first behaviour
  const firstKinds = kinds.slice(0, 3);
  f.machine_first = firstKinds.some((k) => k in CHANNEL_KINDS);
  return f;
}

function peakRate(ts: number[], windowMs: number): number {
  if (ts.length < 2) return ts.length;
  let best = 1;
  let j = 0;
  for (let i = 0; i < ts.length; i++) {
    while ((ts[i] as number) - (ts[j] as number) > windowMs) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

function maxOverlap(ts: number[], latency: number[]): number {
  const intervals = ts.map((t, i) => [t, t + Math.max(1, latency[i] ?? 1)] as const);
  const points: Array<[number, number]> = [];
  for (const [s, e] of intervals) {
    points.push([s, 1]);
    points.push([e, -1]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let best = 0;
  for (const [, d] of points) {
    cur += d;
    best = Math.max(best, cur);
  }
  return best;
}
