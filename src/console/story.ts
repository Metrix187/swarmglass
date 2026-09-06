import type { EventRow, Features } from '../telemetry/features.ts';
import type { Scores } from '../telemetry/scoring.ts';
import { fmtDuration } from '../util/time.ts';

// turns a session's event list into a step-by-step account with observations.
// the wording is careful: it says what the requests did, never who sent them.

export interface StoryStep {
  n: number;
  ts: number;
  rel_ms: number;
  gap_ms: number | null;
  method: string;
  path: string;
  status: number;
  kind: string;
  page_id: string | null;
  discover: string | null;
  depth: number | null;
  negotiated: string | null;
  notes: string[];
  flags: string[]; // machine-friendly tags for styling
}

export interface Story {
  summary: string;
  steps: StoryStep[];
  caveats: string[];
}

interface CanarySeen {
  id: string;
  where: string;
}

export function buildStory(events: EventRow[], features: Features | null, scores: Scores | null, opts: { uaFamily: string; cookieReturned: boolean; synthetic: boolean; persona?: string | null }): Story {
  const ev = [...events].sort((a, b) => a.ts - b.ts);
  const steps: StoryStep[] = [];
  const start = ev[0]?.ts ?? 0;
  const seenPages = new Map<string, number>();
  const exposedAt = new Map<string, { n: number; where: string }>();
  let robotsAt: number | null = null;
  let sitemapAt: number | null = null;
  let feedAt: number | null = null;
  let manifestAt: number | null = null;
  let last429: number | null = null;
  let pendingRedirect: { n: number; ts: number } | null = null;

  ev.forEach((e, i) => {
    const notes: string[] = [];
    const flags: string[] = [];
    const prev = ev[i - 1];
    const gap = prev ? e.ts - prev.ts : null;
    const n = i + 1;

    if (i === 0) {
      notes.push(e.resource_kind === 'robots' ? 'first request was robots.txt, before any page' : e.resource_kind === 'page' && e.page_id === 'Main_Page' ? 'started at the main page' : `started directly at ${describeKind(e)}`);
      flags.push('first');
    }
    if (e.resource_kind === 'robots') {
      robotsAt = n;
      flags.push('channel');
    }
    if (e.resource_kind === 'sitemap') {
      sitemapAt = n;
      flags.push('channel');
    }
    if (e.resource_kind === 'feed') {
      feedAt = n;
      flags.push('channel');
    }
    if (e.resource_kind === 'manifest' || e.resource_kind === 'api') {
      if (manifestAt === null) notes.push(`fetched a machine-readable description (${e.resource_kind}) — tool/api discovery behaviour`);
      manifestAt = n;
      flags.push('machine');
    }
    if (e.robots_disallowed && e.status < 400) {
      flags.push('disallowed');
      notes.push(robotsAt !== null ? `path is disallowed by robots.txt, which was read at step ${robotsAt}` : 'path is disallowed by robots.txt (robots.txt was never fetched)');
    }
    if (e.page_id && e.status < 400 && (e.resource_kind === 'page' || e.resource_kind === 'alt' || e.resource_kind === 'attachment' || e.resource_kind === 'special')) {
      const count = (seenPages.get(e.page_id) ?? 0) + 1;
      seenPages.set(e.page_id, count);
      if (count > 1) {
        flags.push('revisit');
        notes.push(`revisit of ${e.page_id} (visit ${count})`);
      } else if (e.discover_class && e.discover_class !== 'visible') {
        flags.push('hidden');
        const via = channelNote(e.discover_class, { robotsAt, sitemapAt, feedAt, manifestAt, n });
        notes.push(`reached a ${e.discover_class.replace(/_/g, ' ')} page${via}`);
      }
      if (typeof e.depth === 'number' && e.depth >= 4 && count === 1) notes.push(`depth ${e.depth} — this is deep`);
    }
    if (e.negotiated && e.negotiated !== 'html') {
      flags.push('alt');
      const viaAccept = /\.(json|txt|yaml)$/.test(e.path) || e.path.includes('action=raw') ? 'by explicit path' : 'via the Accept header';
      notes.push(`received the ${e.negotiated} representation ${viaAccept}`);
    }
    if (e.method === 'HEAD') {
      flags.push('head');
      const next = ev[i + 1];
      if (next && next.method === 'GET' && next.path === e.path) notes.push('HEAD followed by GET of the same path');
    }
    if (e.method === 'POST' || e.method === 'PUT' || e.method === 'PATCH') {
      flags.push('write');
      notes.push(`attempted a ${e.method} (read-only mirror answered ${e.status})`);
    }
    if (e.status >= 300 && e.status < 400) {
      flags.push('redirect');
      pendingRedirect = { n, ts: e.ts };
    } else if (pendingRedirect && e.ts - pendingRedirect.ts < 5000 && e.status < 400) {
      notes.push(`followed the redirect from step ${pendingRedirect.n} after ${fmtDuration(e.ts - pendingRedirect.ts)}`);
      pendingRedirect = null;
    }
    if (e.status === 404) {
      flags.push('missing');
      const cnt = ev.slice(0, i).filter((x) => x.path === e.path && x.status === 404).length;
      notes.push(cnt ? `404 again for the same path (${cnt + 1} times)` : 'dead link / missing page');
    }
    if (e.status === 410) {
      flags.push('gone');
      notes.push('page marked gone (410) — listed only in the stale index / archive sitemap');
    }
    if (e.status === 429) {
      flags.push('limited');
      last429 = n;
      notes.push('rate limited');
    } else if (last429 !== null && n === last429 + 1) {
      notes.push(gap !== null && gap < 1000 ? `continued ${fmtDuration(gap)} after a 429 — ignored Retry-After` : `resumed ${fmtDuration(gap ?? 0)} after a 429`);
    }
    if (e.malformed) {
      flags.push('malformed');
      try {
        notes.push(`unusual request: ${(JSON.parse(e.malformed) as string[]).join(', ')}`);
      } catch {
        notes.push('unusual request');
      }
    }
    if (e.canaries_exposed) {
      try {
        for (const id of JSON.parse(e.canaries_exposed) as string[]) if (!exposedAt.has(id)) exposedAt.set(id, { n, where: e.resource_kind });
      } catch {
        // ignore
      }
    }
    if (e.canaries_seen) {
      try {
        for (const s of JSON.parse(e.canaries_seen) as CanarySeen[]) {
          flags.push('canary');
          const ex = exposedAt.get(s.id);
          notes.push(ex ? `presented canary ${s.id} in ${s.where} — it was shown at step ${ex.n} (${ex.where}) — memory-like reuse` : `presented canary ${s.id} in ${s.where} — never shown to this session (cross-session or external source)`);
        }
      } catch {
        // ignore
      }
    }
    if (gap !== null && gap < 50 && i > 0) flags.push('burst');
    if (gap !== null && gap > 120_000) notes.push(`${fmtDuration(gap)} pause before this request`);
    if (e.resource_kind === 'asset' && i > 0 && !steps.some((s) => s.kind === 'asset')) notes.push('fetched a page asset (stylesheet/script/favicon) — rendering-browser behaviour');
    if (e.query_json && e.resource_kind === 'special' && e.page_id === 'Special:Search') {
      try {
        const q = JSON.parse(e.query_json) as Record<string, string>;
        if (q.search) notes.push(`searched for “${q.search}”`);
      } catch {
        // ignore
      }
    }

    steps.push({ n, ts: e.ts, rel_ms: e.ts - start, gap_ms: gap, method: e.method, path: e.path, status: e.status, kind: e.resource_kind, page_id: e.page_id, discover: e.discover_class, depth: e.depth, negotiated: e.negotiated, notes, flags });
  });

  // burst annotation after the fact
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as StoryStep;
    if (!s.flags.includes('burst')) continue;
    let j = i;
    while (j + 1 < steps.length && (steps[j + 1] as StoryStep).flags.includes('burst')) j++;
    const size = j - i + 2;
    if (size >= 4 && !(steps[i - 1] as StoryStep | undefined)?.notes.some((x) => x.startsWith('burst'))) (steps[i - 1] ?? s).notes.push(`burst: ${size} requests within ${fmtDuration((steps[j] as StoryStep).ts - (steps[i - 1] ?? s).ts)}`);
    i = j;
  }

  const caveats = [
    'User-agent strings are self-declared and unverified.',
    'Session boundaries are inferred (cookie or 30-minute idle window on a coarse fingerprint); one client may appear as several sessions and several clients may collapse into one.',
    'Class labels are research heuristics with stated evidence, not determinations about who or what sent the traffic.',
  ];
  if (opts.synthetic) caveats.unshift(`SYNTHETIC traffic from the test generator (persona: ${opts.persona ?? 'unknown'}). Never mix with real observations.`);

  return { summary: summarize(ev, features, scores, opts), steps, caveats };
}

function describeKind(e: EventRow): string {
  if (e.page_id) return `${e.resource_kind} ${e.page_id}`;
  return `${e.resource_kind} ${e.path}`;
}

function channelNote(cls: string, s: { robotsAt: number | null; sitemapAt: number | null; feedAt: number | null; manifestAt: number | null; n: number }): string {
  const map: Record<string, number | null> = { robots_only: s.robotsAt, sitemap_only: s.sitemapAt, feed_only: s.feedAt, manifest_only: s.manifestAt, api_only: s.manifestAt };
  if (cls in map) {
    const at = map[cls];
    return at !== null && at !== undefined ? ` — the channel that lists it was fetched at step ${at}` : ' — without fetching the channel that lists it (prior knowledge, a guess, or an index we did not see)';
  }
  if (cls === 'orphan') return ' — nothing on this site points at it';
  return '';
}

function summarize(ev: EventRow[], f: Features | null, s: Scores | null, opts: { uaFamily: string; cookieReturned: boolean; synthetic: boolean }): string {
  if (!ev.length) return 'No requests recorded.';
  const dur = (ev[ev.length - 1] as EventRow).ts - (ev[0] as EventRow).ts;
  const pages = new Set(ev.filter((e) => e.page_id && e.status < 400).map((e) => e.page_id));
  const parts: string[] = [];
  parts.push(`${ev.length} request${ev.length === 1 ? '' : 's'} over ${fmtDuration(dur)}, ${pages.size} distinct page${pages.size === 1 ? '' : 's'}.`);
  parts.push(`Declared user-agent family: ${opts.uaFamily} (self-reported).`);
  if (s) parts.push(`Likely class: ${s.likely_class.replace(/_/g, ' ')} (margin ${s.confidence.toFixed(2)} over the runner-up; heuristics v${s.heuristics_version}).`);
  if (f) {
    const bits: string[] = [];
    if (f.fetched_robots) bits.push(f.robots_first ? 'read robots.txt first' : 'read robots.txt');
    if (typeof f.n_disallowed === 'number' && f.n_disallowed > 0) bits.push(`fetched ${f.n_disallowed} disallowed path${f.n_disallowed === 1 ? '' : 's'}`);
    if (typeof f.n_asset === 'number') bits.push(f.n_asset > 0 ? `fetched ${f.n_asset} page asset${f.n_asset === 1 ? '' : 's'}` : 'never fetched page assets');
    bits.push(opts.cookieReturned ? 'returned the session cookie' : 'never returned the session cookie');
    if (typeof f.max_depth === 'number') bits.push(`max depth ${f.max_depth}`);
    if (typeof f.bfs_score === 'number' && typeof f.n_unique_pages === 'number' && f.n_unique_pages >= 6) bits.push(f.bfs_score >= 0.7 ? 'breadth-first order' : f.bfs_score < 0.5 ? 'depth-first order' : 'mixed traversal order');
    if (typeof f.hidden_hits === 'number' && f.hidden_hits > 0) bits.push(`reached ${f.hidden_hits} hidden page${f.hidden_hits === 1 ? '' : 's'}`);
    if (typeof f.n_alt === 'number' && f.n_alt > 0) bits.push(`${f.n_alt} alternate representation${f.n_alt === 1 ? '' : 's'}`);
    if (typeof f.canary_seen === 'number' && f.canary_seen > 0) bits.push(`presented ${f.canary_seen} canar${f.canary_seen === 1 ? 'y' : 'ies'}`);
    if (typeof f.median_gap_ms === 'number' && ev.length > 3) bits.push(`median gap ${fmtDuration(f.median_gap_ms)}`);
    if (typeof f.concurrency === 'number' && f.concurrency > 1) bits.push(`up to ${f.concurrency} in flight`);
    parts.push(bits.join('; ') + '.');
  }
  return parts.join(' ');
}
