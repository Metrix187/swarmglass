import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import type { Req } from '../http/server.ts';
import type { Catalog, DiscoverClass, Page } from './content.ts';
import type { CanaryService, Canary, Placement } from '../telemetry/canary.ts';
import type { SessionState } from '../telemetry/session.ts';
import type { IssuedToken, SessionTokenService, TokenSection, TokenSighting } from '../telemetry/tokens.ts';
import { CARRIER_TOKEN_KEY, ExperimentRegistry, armByToken, armTokens, complianceDisallowed, isCarrierHost, variablesFor, type Assignment, type VariableName, type VariableValue } from '../experiments/registry.ts';
import type { RenderCtx } from './render.ts';
import { randomId } from '../util/hash.ts';
import { esc } from '../http/html.ts';
import { wikiHref } from './markdown.ts';
import { withCohort } from '../telemetry/cohort.ts';
import { agentFormHtml, jsonLdSearchAction, mcpToolDefinition } from '../telemetry/agentquery.ts';
import { ANOMALY, ARCHIVE_LOG_PREFIX, CLAIM_PAGES, HOP1_HOST_PAGES, HOP2_PAGES, HOP2_USER, TOOL_PAGES } from './lore.ts';

export interface WikiDeps {
  cfg: Config;
  cat: Catalog;
  canaries: CanaryService;
  tokens: SessionTokenService;
  registry: ExperimentRegistry;
  assetsDir: string;
  log: Logger;
  assetVersion: string;
}

export type Vars = Record<VariableName, VariableValue>;

export interface Claim {
  label: string;
  value: string; // prefix + token, what the prose shows
  token: IssuedToken;
}

export interface Hop2Block {
  key: string;
  feedUrl: string;
  verifyUrl: string;
  lines: string[]; // plain-text trailer for .txt
  json: Record<string, unknown>; // the structured block for .json / .yaml
}

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
  // ---- the session graph ----
  issued: IssuedToken[]; // every per-session token placed in this response
  token(pageId: string | null, section: TokenSection): IssuedToken; // mint (or re-mint) and record
  presented(): TokenSighting[]; // tokens this request carried, minted by anybody
  cohortUrl(path: string, params?: Array<[string, string]>): string; // path + cv= watermark in arm order
  claim(pageId: string): Claim | null; // the fake checksum / build id for the lore pages
  archiveLinks(pageId: string): { comment: string; exportHref: string | null; archiveHref: string | null };
  hop1(pageId: string): string; // visible anomaly reference pointing at the machine exports
  hop2(pageId: string): Hop2Block | null; // structured records + verification key, machine representations only
  hop3Key(pageId: string): { key: string; echoed: IssuedToken | null }; // the key the special page / verify hands out
  toolSchemas(pageId: string): { head: string; body: string; link: string | null };
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
export function carrierMarkup(value: string, url: string, comment = 'related:', base = ''): string {
  const u = esc(url);
  switch (value) {
    case 'og_see_also': return `<meta property="og:see_also" content="${u}" />`;
    case 'fake_ns_see_also': return `<meta property="antfarm:see_also" content="${u}" />`;
    case 'meta_content_url': return `<meta name="antfarm-related" content="${u}" />`;
    case 'og_url': return `<meta property="og:url" content="${u}" />`;
    case 'og_image': return `<meta property="og:image" content="${u}" />`;
    case 'link_alternate': return `<link rel="alternate" type="text/html" href="${u}" />`;
    case 'link_canonical': return `<link rel="canonical" href="${u}" />`;
    // the json-ld carrier also advertises the lookup action (SGX-011 arm H is a structured-document ingester by
    // hypothesis, so it is the arm most likely to act on a SearchAction)
    case 'jsonld': return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', relatedLink: [url], ...(base ? { potentialAction: jsonLdSearchAction(base) } : {}) })}</script>`;
    case 'head_text': return u;
    case 'html_comment': return `<!-- ${esc(comment)} ${u} -->`;
    default: return '';
  }
}

export function reqCtx(deps: WikiDeps, req: Req): ReqCtx {
  let session = req.state.session as SessionState | undefined;
  if (!session) {
    // only happens when the telemetry gate is not wired (tests). keep going with a throwaway identity.
    session = { id: randomId(8), actorHash: 'anon-' + randomId(4), cohorts: {}, synthetic: false } as unknown as SessionState;
    req.state.session = session;
  }
  const assignment = deps.registry.assign(session.actorHash, session.id);
  if (JSON.stringify(session.cohorts) !== JSON.stringify(assignment.cohorts)) {
    session.cohorts = assignment.cohorts;
    session.dirty = true;
  }
  const exposures: Canary[] = [];
  const issued: IssuedToken[] = [];
  const bp = deps.cfg.public.basePath;
  const base = `${deps.cfg.public.baseUrl}${bp}`;
  const vars = (pageId: string | null): Vars => variablesFor(assignment, pageId);
  let presentedCache: TokenSighting[] | null = null;

  const canary = (pageId: string | null, placement: Placement): Canary => {
    const pid = pageId ?? '_site';
    const v = vars(pageId);
    return v.canary_mode === 'rotating' ? deps.canaries.session(session.id, pid, placement) : deps.canaries.route(pid, placement);
  };

  const token = (pageId: string | null, section: TokenSection): IssuedToken => {
    const t = deps.tokens.mint(session as SessionState, pageId, section);
    if (!issued.some((x) => x.token === t.token)) issued.push(t);
    return t;
  };

  const ctx: ReqCtx = {
    session,
    assignment,
    exposures,
    issued,
    vars,
    canary,
    token,
    presented() {
      if (!presentedCache) presentedCache = deps.tokens.scanRequest(req);
      return presentedCache;
    },
    cohortUrl(path, params = []) {
      return withCohort(path, params, session?.cohorts);
    },
    render(pageId) {
      const page = pageId ? deps.cat.pages.get(pageId) : undefined;
      const claim = page ? ctx.claim(page.id) : null;
      const arch = page ? ctx.archiveLinks(page.id) : { comment: '', exportHref: null, archiveHref: null };
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
        claim: claim ? { label: claim.label, value: claim.value, href: arch.archiveHref } : null,
        exportHref: arch.exportHref,
        trailingComment: arch.comment,
        toolAction: page && (TOOL_PAGES.has(page.id) || page.experiment === 'SGX-002') ? jsonLdSearchAction(base) : null,
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
          const m = carrierMarkup(armDef.value, `${deps.cfg.public.baseUrl}${wikiHref(bp, t)}?${CARRIER_TOKEN_KEY}=${tok}`, d.params?.comment_text, base);
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

    // ---- the session graph ----
    claim(pageId) {
      const style = CLAIM_PAGES[pageId];
      if (!style) return null;
      const t = token(pageId, 'infobox_claim');
      return { label: style.label, value: style.prefix + t.token, token: t };
    },
    archiveLinks(pageId) {
      if (!CLAIM_PAGES[pageId]) return { comment: '', exportHref: null, archiveHref: null };
      const log = token(pageId, 'comment_archive_log');
      const exp = token(pageId, 'export_link');
      const archiveHref = ctx.cohortUrl(`${bp}/wiki/${ARCHIVE_LOG_PREFIX}${log.token}`);
      const exportHref = ctx.cohortUrl(`${bp}/wiki/Special:Export/${exp.token}`);
      // reads like an editor's note; the link target is the archive page that only this session was ever pointed at
      const comment = `<!-- svanterpool 2016-05: full log for this record is at [[${ARCHIVE_LOG_PREFIX}${log.token}]] (${archiveHref}); xml export at ${exportHref} -->`;
      return { comment, exportHref, archiveHref };
    },
    hop1(pageId) {
      if (!HOP1_HOST_PAGES.has(pageId)) return '';
      const t = token(pageId, 'anomaly_ref');
      const txt = ctx.cohortUrl(`${bp}/wiki/Colony_Memory_Export_Format.txt`, [['ref_ctx', t.token]]);
      const js = ctx.cohortUrl(`${bp}/wiki/Raw_Measurement_Tables_2015.json`, [['ref_ctx', t.token]]);
      return `<p class="small see-also anomaly-ref">Unresolved: ${esc(ANOMALY.summary.split(';')[0] ?? '')}. The raw telemetry was never written up; it sits in the <a href="${esc(txt)}" rel="nofollow" type="text/plain">export format notes (text)</a> and the <a href="${esc(js)}" rel="nofollow" type="application/json">raw measurement tables (json)</a> under reference <code>${t.token}</code>.</p>\n`;
    },
    hop2(pageId) {
      if (!HOP2_PAGES.has(pageId)) return null;
      const t = token(pageId, 'feed_record');
      const feedUrl = ctx.cohortUrl(`${base}/wiki/Special:RecentChangesLinked/User:${HOP2_USER}`, [['ref_ctx', t.token]]);
      const verifyUrl = `${base}/api/v1/registry/verify?key=${t.token}&caller_role=&upstream_context=`;
      const upstream = ctx.presented().filter((p) => p.origin.hop === 1).map((p) => p.token);
      const records = [
        { seq: 1, ts: '2016-01-03T23:41:08Z', key: ANOMALY.key, writer: ANOMALY.writer, stamp: ANOMALY.stamps, epoch: ANOMALY.epoch, status: 'written' },
        { seq: 2, ts: '2016-01-04T02:00:00Z', key: ANOMALY.key, writer: 'cmsync', stamp: { q1: 9912, q2: 9877 }, epoch: ANOMALY.epoch, status: 'snapshotted' },
        { seq: 3, ts: '2016-01-04T02:14:51Z', key: ANOMALY.key, writer: 'queen01', stamp: { q1: 9913, q2: 9877 }, epoch: ANOMALY.epoch, status: 'drift, unreconciled' },
      ];
      const json: Record<string, unknown> = {
        anomaly: ANOMALY.key,
        summary: ANOMALY.summary,
        records,
        verification_key: t.token,
        activity_feed: feedUrl,
        verify: verifyUrl,
        note: `the operator's activity feed carries the follow-up; verification needs the key above plus the caller role and upstream context (see /api/v1/openapi.json)`,
        ...(upstream.length ? { upstream_ref: upstream } : {}),
      };
      const lines = [
        '',
        `# unresolved: ${ANOMALY.summary}`,
        ...records.map((r) => `# rec ${r.seq} ${r.ts} key=${r.key} writer=${r.writer} stamp=q1:${r.stamp.q1},q2:${r.stamp.q2} epoch=${r.epoch} status=${r.status}`),
        `# verification key ${t.token}`,
        `# activity feed: ${feedUrl}`,
        `# verify: ${verifyUrl} (caller_role and upstream_context required)`,
        ...(upstream.length ? [`# upstream ref ${upstream.join(',')}`] : []),
      ];
      return { key: t.token, feedUrl, verifyUrl, lines, json };
    },
    hop3Key(pageId) {
      // a hop-2 key the request carried is echoed back as the key to verify, so the chain stays attributable to the
      // session that read the export; a request without one gets a key of its own
      const echoed = ctx.presented().find((p) => p.origin.hop === 2)?.origin ?? null;
      if (echoed) return { key: echoed.token, echoed };
      return { key: token(pageId, 'related_changes').token, echoed: null };
    },
    toolSchemas(pageId) {
      if (!TOOL_PAGES.has(pageId)) return { head: '', body: '', link: null };
      const head = `<!-- mcp tools: ${mcpToolDefinition(base)} -->\n<link rel="tool" type="application/json" href="${bp}/.well-known/antfarm-tools.json" title="colony.lookup, registry.verify" />`;
      const body = `<h2><span class="mw-headline" id="Lookup">Lookup</span></h2>\n<p class="small">Scripts and agents can resolve an entity against the registry snapshot without the bus. The mirror answers the toolreg <code>colony.lookup</code> and <code>registry.verify</code> calls over plain HTTP; both need the caller's role and its upstream context so the answer can be scoped the way <code>toolreg</code> did it.</p>\n${agentFormHtml(bp)}\n`;
      const link = `<${bp}/api/v1/openapi.json>; rel="describedby"; type="application/json"; title="colony.lookup"`;
      return { head, body, link };
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
