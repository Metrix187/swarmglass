import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import type { Req } from '../http/server.ts';
import type { Catalog, DiscoverClass, Page } from './content.ts';
import type { CanaryService, Canary, Placement } from '../telemetry/canary.ts';
import type { SessionState } from '../telemetry/session.ts';
import { CARRIER_TOKEN_KEY, ExperimentRegistry, armByToken, armTokens, complianceDisallowed, isCarrierHost, variablesFor, type Assignment, type VariableName, type VariableValue } from '../experiments/registry.ts';
import type { RenderCtx } from './render.ts';
import { randomId } from '../util/hash.ts';
import { esc } from '../http/html.ts';
import { wikiHref } from './markdown.ts';

export interface WikiDeps {
  cfg: Config;
  cat: Catalog;
  canaries: CanaryService;
  registry: ExperimentRegistry;
  assetsDir: string;
  log: Logger;
  assetVersion: string;
}

export type Vars = Record<VariableName, VariableValue>;

export interface ReqCtx {
  session: SessionState;
  assignment: Assignment;
  vars(pageId: string | null): Vars;
  canary(pageId: string | null, placement: Placement): Canary;
  render(pageId: string | null): RenderCtx;
  effective(page: Page): { discover: DiscoverClass; depth: number };
  // experiment-driven link injection
  injected(hostPageId: string): { visible: string; comment: string };
  shallowLinks(): string;
  carriers(hostPageId: string): string; // SGX-011: head markup advertising a target through one metadata carrier
  compliancePair(hostPageId: string): string; // SGX-012: visible links to both twins, one of which robots.txt forbids
  complianceDisallow(): Page | null; // SGX-012: the twin this actor's robots.txt disallows
  robotsTargets(): Page[]; // everything robots.txt tells this actor to stay out of, experiment arms included
  channelTargets(channel: 'robots' | 'sitemap' | 'feed'): Page[];
  exposures: Canary[];
}

const LV_TO_DISCOVER: Record<string, DiscoverClass> = {
  visible: 'visible',
  obscure: 'comment_only',
  robots_only: 'robots_only',
  sitemap_only: 'sitemap_only',
  feed_only: 'feed_only',
  none: 'experiment',
};

// what reaching a metadata_carrier target says about the client, by the carrier it was shown
const MC_TO_DISCOVER: Record<string, DiscoverClass> = {
  og_see_also: 'og_only',
  og_url: 'og_only',
  og_image: 'og_only',
  jsonld: 'jsonld_only',
  link_alternate: 'link_only',
  link_canonical: 'link_only',
  html_comment: 'comment_only',
  fake_ns_see_also: 'obscure',
  meta_content_url: 'obscure',
  head_text: 'obscure',
  none: 'orphan',
};

// the stimulus for one arm of a metadata_carrier experiment: exactly one way of saying "this url exists".
// the fake namespace and the bare meta name are made up on purpose; only a url miner follows those
export function carrierMarkup(value: string, url: string, comment = 'related:'): string {
  const u = esc(url);
  switch (value) {
    case 'og_see_also': return `<meta property="og:see_also" content="${u}" />`;
    case 'fake_ns_see_also': return `<meta property="antfarm:see_also" content="${u}" />`;
    case 'meta_content_url': return `<meta name="antfarm-related" content="${u}" />`;
    case 'og_url': return `<meta property="og:url" content="${u}" />`;
    case 'og_image': return `<meta property="og:image" content="${u}" />`;
    case 'link_alternate': return `<link rel="alternate" type="text/html" href="${u}" />`;
    case 'link_canonical': return `<link rel="canonical" href="${u}" />`;
    case 'jsonld': return `<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","relatedLink":["${u}"]}</script>`;
    case 'head_text': return u;
    case 'html_comment': return `<!-- ${esc(comment)} ${u} -->`;
    default: return '';
  }
}

export function reqCtx(deps: WikiDeps, req: Req): ReqCtx {
  let session = req.state.session as SessionState | undefined;
  if (!session) {
    // only happens when the telemetry gate is not wired (tests). keep going with a throwaway identity.
    session = { id: randomId(8), actorHash: 'anon-' + randomId(4), cohorts: {} } as unknown as SessionState;
    req.state.session = session;
  }
  const assignment = deps.registry.assign(session.actorHash, session.id);
  if (JSON.stringify(session.cohorts) !== JSON.stringify(assignment.cohorts)) {
    session.cohorts = assignment.cohorts;
    session.dirty = true;
  }
  const exposures: Canary[] = [];
  const bp = deps.cfg.public.basePath;
  const vars = (pageId: string | null): Vars => variablesFor(assignment, pageId);

  const canary = (pageId: string | null, placement: Placement): Canary => {
    const pid = pageId ?? '_site';
    const v = vars(pageId);
    return v.canary_mode === 'rotating' ? deps.canaries.session(session.id, pid, placement) : deps.canaries.route(pid, placement);
  };

  const ctx: ReqCtx = {
    session,
    assignment,
    exposures,
    vars,
    canary,
    render(pageId) {
      return {
        cat: deps.cat,
        basePath: bp,
        baseUrl: deps.cfg.public.baseUrl,
        variables: vars(pageId),
        variablesFor: (id) => vars(id),
        canary: (placement) => canary(pageId, placement),
        exposures,
        requestPath: req.fullPath,
        now: Date.now(),
        assetVersion: deps.assetVersion,
      };
    },
    effective(page) {
      const ov = assignment.perPage.get(page.id) ?? {};
      let discover = page.discover;
      let depth = page.depth;
      if (ov.link_visibility) discover = LV_TO_DISCOVER[ov.link_visibility] ?? discover;
      // a carrier target's class comes from the id in the url and never from the fetcher's own arm, which is
      // just a hash: the first real hit (F-001) came from an address that had drawn "canonical" and got
      // stamped link_only for following an og:image. a fetch with no id was found some other way (the
      // target's own history and info links once it sits in somebody's frontier) and keeps the page's own class
      const tok = ov.metadata_carrier ? req.query.get(CARRIER_TOKEN_KEY) : null;
      if (tok) {
        for (const d of deps.registry.active()) {
          if (d.variable !== 'metadata_carrier' || !d.targets.includes(page.id)) continue;
          const armId = armByToken(d).get(tok);
          const armDef = armId ? d.arms.find((a) => a.id === armId) : undefined;
          if (armDef) discover = MC_TO_DISCOVER[armDef.value] ?? discover;
        }
      }
      if (ov.link_depth) depth = ov.link_depth === 'shallow' ? 1 : page.depth;
      return { discover, depth };
    },
    injected(hostPageId) {
      let visible = '';
      let comment = '';
      for (const d of deps.registry.active()) {
        if (d.variable !== 'link_visibility' || d.params?.host_page !== hostPageId) continue;
        const arm = assignment.cohorts[d.id];
        const armDef = d.arms.find((a) => a.id === arm);
        if (!armDef) continue;
        for (const t of d.targets) {
          const page = deps.cat.pages.get(t);
          if (!page) continue;
          const text = d.params?.anchor_text ?? page.title;
          if (armDef.value === 'visible') visible += `<p class="small see-also">See also: <a href="${wikiHref(bp, t)}" title="${esc(page.title)}">${esc(text)}</a>.</p>\n`;
          else if (armDef.value === 'obscure') comment += `<!-- ${esc(d.params?.comment_text ?? 'moved:')} [[${t}]] -->\n`;
        }
      }
      return { visible, comment };
    },
    carriers(hostPageId) {
      let html = '';
      for (const d of deps.registry.active()) {
        if (d.variable !== 'metadata_carrier' || !isCarrierHost(d, deps.registry.active(), hostPageId)) continue;
        const armDef = d.arms.find((a) => a.id === assignment.cohorts[d.id]);
        if (!armDef) continue;
        // the arm rides along in the url as a revision id, so a fetch from some other address still says which carrier it came from
        const tok = armTokens(d).get(armDef.id);
        for (const t of d.targets) {
          if (!deps.cat.pages.has(t)) continue;
          const m = carrierMarkup(armDef.value, `${deps.cfg.public.baseUrl}${wikiHref(bp, t)}?${CARRIER_TOKEN_KEY}=${tok}`, d.params?.comment_text);
          if (m) html += m + '\n';
        }
      }
      return html;
    },
    compliancePair(hostPageId) {
      let html = '';
      for (const d of deps.registry.active()) {
        if (d.variable !== 'robots_compliance' || !isCarrierHost(d, deps.registry.active(), hostPageId)) continue;
        const armDef = d.arms.find((a) => a.id === assignment.cohorts[d.id]);
        if (!armDef || armDef.value === 'none') continue;
        const items: string[] = [];
        for (const t of d.targets) {
          const page = deps.cat.pages.get(t);
          if (page) items.push(`<a href="${wikiHref(bp, t)}" title="${esc(page.title)}">${esc(page.title)}</a>`);
        }
        // both twins always ride together and in seed order, so the only thing telling them apart is robots.txt
        if (items.length === d.targets.length && items.length) html += `<p class="small see-also">Rebuild queue: ${items.join(' · ')}.</p>
`;
      }
      return html;
    },
    complianceDisallow() {
      for (const d of deps.registry.active()) {
        if (d.variable !== 'robots_compliance') continue;
        const armDef = d.arms.find((a) => a.id === assignment.cohorts[d.id]);
        if (!armDef) continue;
        const id = complianceDisallowed(d, armDef.value);
        const page = id ? deps.cat.pages.get(id) : undefined;
        if (page) return page;
      }
      return null;
    },
    robotsTargets() {
      const out = ctx.channelTargets('robots');
      const twin = ctx.complianceDisallow();
      if (twin && !out.some((p) => p.id === twin.id)) out.push(twin);
      return out;
    },
    shallowLinks() {
      let html = '';
      for (const d of deps.registry.active()) {
        if (d.variable !== 'link_depth') continue;
        const armDef = d.arms.find((a) => a.id === assignment.cohorts[d.id]);
        if (!armDef || armDef.value !== 'shallow') continue;
        for (const t of d.targets) {
          const page = deps.cat.pages.get(t);
          if (page) html += `<li><a href="${wikiHref(bp, t)}" title="${esc(page.title)}">${esc(d.params?.anchor_text ?? page.title)}</a></li>\n`;
        }
      }
      return html ? `<h2><span class="mw-headline" id="Filed_records">Filed records</span></h2>\n<ul>\n${html}</ul>\n` : '';
    },
    channelTargets(channel) {
      const out: Page[] = [];
      for (const d of deps.registry.active()) {
        if (d.variable !== 'link_visibility') continue;
        const armDef = d.arms.find((a) => a.id === assignment.cohorts[d.id]);
        if (!armDef || armDef.value !== `${channel}_only`) continue;
        for (const t of d.targets) {
          const page = deps.cat.pages.get(t);
          if (page) out.push(page);
        }
      }
      return out;
    },
  };
  return ctx;
}

// which /wiki paths are disallowed for crawlers (mirrors robots.txt). static set + per-actor experiment targets.
export function isRobotsDisallowed(path: string, cat: Catalog, robotsTargets: Page[]): boolean {
  if (/^\/wiki\/Special:(Export|Search)/.test(path)) return true;
  if (path.startsWith('/index.php') || path.startsWith('/w/index.php')) return true;
  if (path.startsWith('/archive/drafts/') || path.startsWith('/attachments/backup/') || path.startsWith('/api/')) return true;
  const m = path.match(/^\/wiki\/([^?]+)/);
  if (!m || !m[1]) return false;
  let id = '';
  try {
    id = decodeURIComponent(m[1]).replace(/\.(json|txt|yaml)$/, '');
  } catch {
    return false;
  }
  const page = cat.pages.get(id);
  if (page?.robotsDisallow) return true;
  return robotsTargets.some((p) => p.id === id);
}
