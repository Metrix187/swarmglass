import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import type { Req } from '../http/server.ts';
import type { Catalog, DiscoverClass, Page } from './content.ts';
import type { CanaryService, Canary, Placement } from '../telemetry/canary.ts';
import type { SessionState } from '../telemetry/session.ts';
import { ExperimentRegistry, variablesFor, type Assignment, type VariableName, type VariableValue } from '../experiments/registry.ts';
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
