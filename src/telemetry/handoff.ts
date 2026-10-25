import type { Catalog } from '../wiki/content.ts';
import { resolveAlias } from '../wiki/content.ts';
import { median } from '../util/time.ts';

// where did a visitor get a url it was never shown? a corpus-building pool coordinates through a shared queue:
// one address is served a page, another address fetches what that page linked to. F-001 found that by hand for
// the og:image carrier; this asks the same question of every page the seed's link graph knows about. a reach is
// "explained" when the actor itself, in any session, had already been served a page that links to it or a
// channel that lists it. an unexplained reach whose linking page (or listing channel) was served to a *different*
// actor shortly before is a handoff between the two. no referer is needed: the swarm never sends one.

export interface LinkGraph {
  parents: Map<string, string[]>; // page -> pages whose prose or comments link to it
  channels: Map<string, string[]>; // page -> the machine channels that list it, as "channel:<name>" pseudo-pages
  // pages anybody can know without being told: the entry page and everything one link away from it. reaching
  // one of those says nothing about where the url came from
  entry: Set<string>;
}

export const CHANNEL_KINDS: ReadonlySet<string> = new Set(['robots', 'sitemap', 'feed', 'manifest', 'api', 'index', 'stale_index']);

// the channel pseudo-page a fetch of a machine resource counts as. the archive sitemap is its own channel
export function channelPage(kind: string, path: string): string | null {
  if (!CHANNEL_KINDS.has(kind)) return null;
  if (kind === 'sitemap' && path.includes('archive')) return 'channel:stale_index';
  return `channel:${kind}`;
}

// which channel lists which page, by the same rules the channels themselves use (wiki/machine.ts). the feed's
// recent-changes entries churn and are left out; pages the feed names explicitly are in
export function buildLinkGraph(cat: Catalog, extraEntry: string[] = []): LinkGraph {
  const parents = new Map<string, string[]>();
  const channels = new Map<string, string[]>();
  const entry = new Set<string>(extraEntry);
  const add = (map: Map<string, string[]>, k: string, v: string) => {
    const arr = map.get(k);
    if (arr) {
      if (!arr.includes(v)) arr.push(v);
    } else map.set(k, [v]);
  };
  for (const p of cat.pages.values()) {
    for (const l of [...p.links, ...p.commentLinks]) {
      const t = resolveAlias(cat.pages, l);
      if (t && t !== p.id) add(parents, t, p.id);
    }
    if (p.depth <= 1) entry.add(p.id);
    const listable = p.kind !== 'redirect' && p.kind !== 'gone';
    if (listable && p.kind !== 'talk' && !p.robotsDisallow && (p.discover === 'visible' || p.channels.includes('sitemap'))) add(channels, p.id, 'channel:sitemap');
    if (p.discover !== 'orphan' && p.discover !== 'experiment' && !p.robotsDisallow && p.kind !== 'redirect') add(channels, p.id, 'channel:api');
    if (p.discover === 'visible' || p.discover === 'obscure' || p.channels.includes('index') || p.channels.includes('stale_index') || p.kind === 'gone') add(channels, p.id, 'channel:index');
    if (p.channels.includes('stale_index') || p.kind === 'gone') add(channels, p.id, 'channel:stale_index');
    if (p.robotsDisallow || p.channels.includes('robots')) add(channels, p.id, 'channel:robots');
    if (p.channels.includes('feed')) add(channels, p.id, 'channel:feed');
    if (p.channels.includes('manifest')) add(channels, p.id, 'channel:manifest');
  }
  entry.add(cat.main);
  return { parents, channels, entry };
}

export interface Fetch {
  ts: number;
  actor: string;
  session: string;
}

export interface Discovery {
  session: string;
  actor: string;
  page: string;
  ts: number;
  via: string;
}

export interface Handoff {
  from_actor: string;
  to_actor: string;
  from_session: string;
  to_session: string;
  page: string;
  parent: string; // the linking page or listing channel the source had been served
  ts: number;
  lag_ms: number;
}

export interface HandoffReport {
  considered: number; // reaches of pages that needed a source
  explained: number; // the actor had been served a linking page, or a listing channel, itself
  handoffs: Handoff[]; // unexplained, and another actor had the linking page or channel shortly before
  unsourced: number; // unexplained, and nobody we saw had it: an index, a cache, or prior knowledge
  share: number; // handoffs / considered
  median_lag_ms: number | null;
  top_pages: Array<{ page: string; n: number }>;
}

export interface HandoffOpts {
  windowMs?: number; // how far back a source may be, default 24h
  sources?: Set<string>; // only these actors count as sources (a pool's own members); default anyone
  maxHandoffs?: number; // keep only the latest n in the report (the share and the lag use all of them)
}

function furniture(page: string): boolean {
  return page.startsWith('Special:') || page.startsWith('Category:') || page.startsWith('attachment:') || page.startsWith('channel:');
}

// fetches are every successful page render and every channel fetch (as "channel:<name>") by any actor in the
// window, the handing side. discoveries are the first time a session reached a page
export function findHandoffs(graph: LinkGraph, discoveries: Discovery[], fetches: Array<Fetch & { page: string }>, opts: HandoffOpts = {}): HandoffReport {
  const windowMs = opts.windowMs ?? 24 * 3_600_000;
  const byPage = new Map<string, Fetch[]>();
  const actorHad = new Map<string, Map<string, number>>(); // actor -> page or channel -> first fetch ts
  for (const f of fetches) {
    const list = byPage.get(f.page);
    if (list) list.push(f);
    else byPage.set(f.page, [f]);
    let m = actorHad.get(f.actor);
    if (!m) {
      m = new Map();
      actorHad.set(f.actor, m);
    }
    const prev = m.get(f.page);
    if (prev === undefined || f.ts < prev) m.set(f.page, f.ts);
  }
  for (const list of byPage.values()) list.sort((a, b) => a.ts - b.ts);

  const handoffs: Handoff[] = [];
  const pageCounts = new Map<string, number>();
  let considered = 0;
  let explained = 0;
  let unsourced = 0;
  for (const d of discoveries) {
    if (graph.entry.has(d.page) || furniture(d.page)) continue;
    const sources = [...(graph.parents.get(d.page) ?? []), ...(graph.channels.get(d.page) ?? [])];
    considered++;
    // the actor's own history: a linking page or a listing channel served to it earlier, or a referer it could
    // only have had by loading the page it names
    const mine = actorHad.get(d.actor);
    let ok = false;
    if (mine) {
      if (d.via.startsWith('referer:')) {
        const t = mine.get(d.via.slice('referer:'.length));
        ok = t !== undefined && t <= d.ts;
      }
      if (!ok) for (const p of sources) {
        const t = mine.get(p);
        if (t !== undefined && t <= d.ts) {
          ok = true;
          break;
        }
      }
    }
    if (ok) {
      explained++;
      continue;
    }
    // somebody else's history: the latest fetch of a linking page or listing channel by another actor inside the window
    let best: (Fetch & { parent: string }) | null = null;
    for (const p of sources) {
      const list = byPage.get(p);
      if (!list) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i] as Fetch;
        if (f.ts > d.ts) continue;
        if (d.ts - f.ts > windowMs) break;
        if (f.actor === d.actor) continue;
        if (opts.sources && !opts.sources.has(f.actor)) continue;
        if (!best || f.ts > best.ts) best = { ...f, parent: p };
        break;
      }
    }
    if (!best) {
      unsourced++;
      continue;
    }
    handoffs.push({ from_actor: best.actor, to_actor: d.actor, from_session: best.session, to_session: d.session, page: d.page, parent: best.parent, ts: d.ts, lag_ms: d.ts - best.ts });
    pageCounts.set(d.page, (pageCounts.get(d.page) ?? 0) + 1);
  }
  handoffs.sort((a, b) => a.ts - b.ts);
  const lags = handoffs.map((h) => h.lag_ms);
  const kept = opts.maxHandoffs ? handoffs.slice(-opts.maxHandoffs) : handoffs;
  return {
    considered,
    explained,
    handoffs: kept,
    unsourced,
    share: considered ? Math.round((handoffs.length / considered) * 1000) / 1000 : 0,
    median_lag_ms: lags.length ? median(lags) : null,
    top_pages: [...pageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([page, n]) => ({ page, n })),
  };
}

// union-find over handoff edges: the connected groups of actors that pass urls around
export function handoffComponents(handoffs: Handoff[]): Array<{ actors: string[]; edges: number; pages: number }> {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r) as string;
    let cur = a;
    while (parent.get(cur) !== undefined && parent.get(cur) !== r) {
      const next = parent.get(cur) as string;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const h of handoffs) union(h.from_actor, h.to_actor);
  const groups = new Map<string, { actors: Set<string>; edges: number; pages: Set<string> }>();
  for (const h of handoffs) {
    const r = find(h.from_actor);
    const g = groups.get(r) ?? { actors: new Set<string>(), edges: 0, pages: new Set<string>() };
    g.actors.add(h.from_actor);
    g.actors.add(h.to_actor);
    g.edges++;
    g.pages.add(h.page);
    groups.set(r, g);
  }
  return [...groups.values()].map((g) => ({ actors: [...g.actors], edges: g.edges, pages: g.pages.size })).sort((a, b) => b.actors.length - a.actors.length || b.edges - a.edges);
}
