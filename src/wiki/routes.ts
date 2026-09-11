import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { Router, htmlRes, json, redirect, text, type Req, type Res } from '../http/server.ts';
import { negotiate } from '../http/negotiate.ts';
import { esc, pageHref } from '../http/html.ts';
import { wikiHref } from './markdown.ts';
import { resolveAlias, type Page } from './content.ts';
import { renderArticle, simplePage } from './render.ts';
import { pageExportXml, pageJson, pageText, pageYaml } from './alternates.ts';
import * as sp from './special.ts';
import * as mach from './machine.ts';
import { isRobotsDisallowed, reqCtx, type ReqCtx, type WikiDeps } from './context.ts';
import type { ResMeta } from '../telemetry/capture.ts';
import type { Placement } from '../telemetry/canary.ts';
import { scrub } from '../util/text.ts';

// every public route. handlers return Res with `meta` so telemetry knows what was served.
// nothing here reads the database; the wiki is a pure function of (catalog, assignment, request).

type Kind = ResMeta['kind'];

function withMeta(res: Res, meta: ResMeta): Res {
  res.meta = { ...(res.meta ?? {}), ...meta };
  return res;
}

function done(ctx: ReqCtx, res: Res, meta: ResMeta, req: Req, deps: WikiDeps): Res {
  const robots = isRobotsDisallowed(req.fullPath, deps.cat, ctx.robotsTargets());
  return withMeta(revalidate(req, res, meta, deps), { ...meta, canaries: ctx.exposures, robotsDisallowed: robots });
}

// stable documents get an ETag and a Last-Modified, and a 304 when the client already holds the current bytes.
// the request is seen and recorded either way; only the body changes. a crawler that revalidates has a document
// store behind it, one that never does is re-fetching blind (F-001). specials churn, so they stay untagged
const REVALIDATABLE = new Set(['page', 'alt', 'attachment']);
function revalidate(req: Req, res: Res, meta: ResMeta, deps: WikiDeps): Res {
  if (res.status !== 200 || !REVALIDATABLE.has(meta.kind ?? '') || (req.method !== 'GET' && req.method !== 'HEAD')) return res;
  // the footer comment carries the render time ("Served by mirror node 2 in 0.034 secs"); hash without it, or
  // no two fetches ever match and the whole thing is theatre
  const stable = typeof res.body === 'string' ? res.body.replace(/ in \d+\.\d+ secs\./, ' in 0.000 secs.') : res.body;
  const etag = `"${createHash('sha256').update(stable).digest('hex').slice(0, 20)}"`;
  const page = meta.pageId ? deps.cat.pages.get(meta.pageId) : undefined;
  // same fictional clock as the page footer
  const modified = page ? Date.parse(`${page.modified}T14:03:00Z`) : NaN;
  res.headers['etag'] = etag;
  if (!Number.isNaN(modified)) res.headers['last-modified'] = new Date(modified).toUTCString();
  if (!res.headers['cache-control']) res.headers['cache-control'] = 'public, max-age=0, must-revalidate';
  const inm = req.headers['if-none-match'];
  const ims = req.headers['if-modified-since'];
  const tagMatch = inm ? inm.split(',').some((t) => t.trim() === '*' || t.trim().replace(/^W\//, '') === etag) : false;
  const dateMatch = !inm && ims && !Number.isNaN(modified) ? Date.parse(ims) >= modified : false;
  if (!tagMatch && !dateMatch) return res;
  return { ...res, status: 304, body: '' };
}

function cacheHeaders(seconds: number): Record<string, string> {
  return { 'cache-control': `public, max-age=${seconds}` };
}

const MIME: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8' };

export function buildWikiRouter(deps: WikiDeps): Router {
  const r = new Router();
  const bp = deps.cfg.public.basePath;
  const cat = deps.cat;

  // ---- entry + legacy urls ----
  r.get('/', (req) => done(reqCtx(deps, req), redirect(302, `${bp}/wiki/Main_Page`), { kind: 'redirect', route: 'root' }, req, deps), 'root');
  r.get('/wiki', (req) => done(reqCtx(deps, req), redirect(301, `${bp}/wiki/Main_Page`), { kind: 'redirect' }, req, deps), 'wiki_root');
  r.get('/wiki/', (req) => done(reqCtx(deps, req), redirect(301, `${bp}/wiki/Main_Page`), { kind: 'redirect' }, req, deps), 'wiki_root_slash');
  const legacy = (req: Req): Res => {
    const ctx = reqCtx(deps, req);
    const title = req.query.get('title');
    if (!title) return done(ctx, redirect(301, `${bp}/wiki/Main_Page`), { kind: 'redirect', route: 'legacy_index' }, req, deps);
    const q = new URLSearchParams(req.query);
    q.delete('title');
    const qs = q.toString();
    return done(ctx, redirect(301, `${bp}/wiki/${pageHref(scrub(title, 200).replace(/ /g, '_'))}${qs ? '?' + qs : ''}`), { kind: 'redirect', route: 'legacy_index' }, req, deps);
  };
  r.get('/index.php', legacy, 'legacy_index');
  r.get('/w/index.php', legacy, 'legacy_index');

  // ---- assets ----
  r.get('/skins/antfarm/:file', (req) => serveAsset(deps, req, join('skins', 'antfarm', req.params.file ?? '')), 'asset');
  r.get('/favicon.ico', (req) => serveAsset(deps, req, join('images', 'favicon.ico')), 'asset');
  r.get('/images/:file', (req) => serveAsset(deps, req, join('images', req.params.file ?? '')), 'asset');

  // ---- machine-readable channels ----
  r.get('/robots.txt', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, text(200, mach.robotsTxt(deps, ctx), cacheHeaders(3600)), { kind: 'robots', channel: 'robots' }, req, deps);
  }, 'robots');
  r.get('/sitemap.xml', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8', ...cacheHeaders(3600) }, body: mach.sitemapXml(deps, ctx) }, { kind: 'sitemap', channel: 'sitemap' }, req, deps);
  }, 'sitemap');
  r.get('/sitemap-archive.xml', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8', ...cacheHeaders(3600) }, body: mach.sitemapArchiveXml(deps, ctx) }, { kind: 'sitemap', channel: 'stale_index' }, req, deps);
  }, 'sitemap_archive');
  r.get('/feed.atom', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, { status: 200, headers: { 'content-type': 'application/atom+xml; charset=utf-8', ...cacheHeaders(900) }, body: mach.atomFeed(deps, ctx) }, { kind: 'feed', channel: 'feed' }, req, deps);
  }, 'feed_atom');
  r.get('/feed.rss', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8', ...cacheHeaders(900) }, body: mach.rssFeed(deps, ctx) }, { kind: 'feed', channel: 'feed' }, req, deps);
  }, 'feed_rss');
  r.get('/opensearch_desc.xml', (req) => done(reqCtx(deps, req), { status: 200, headers: { 'content-type': 'application/opensearchdescription+xml; charset=utf-8', ...cacheHeaders(86400) }, body: mach.opensearchXml(deps) }, { kind: 'manifest' }, req, deps), 'opensearch');
  r.get('/humans.txt', (req) => done(reqCtx(deps, req), text(200, mach.humansTxt(deps), cacheHeaders(86400)), { kind: 'manifest' }, req, deps), 'humans');
  r.get('/.well-known/security.txt', (req) => done(reqCtx(deps, req), text(200, mach.securityTxt(deps), cacheHeaders(86400)), { kind: 'manifest' }, req, deps), 'security_txt');
  r.get('/security.txt', (req) => done(reqCtx(deps, req), redirect(301, `${bp}/.well-known/security.txt`), { kind: 'redirect' }, req, deps), 'security_txt_legacy');
  r.get('/llms.txt', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, text(200, mach.llmsTxt(deps, ctx), cacheHeaders(3600)), { kind: 'manifest', channel: 'manifest' }, req, deps);
  }, 'llms_txt');
  r.get('/.well-known/antfarm-tools.json', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, json(200, mach.toolsManifest(deps, ctx), cacheHeaders(3600)), { kind: 'manifest', channel: 'manifest' }, req, deps);
  }, 'tools_manifest');
  r.get('/.well-known/ai-plugin.json', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, json(200, mach.aiPluginManifest(deps, ctx), cacheHeaders(3600)), { kind: 'manifest', channel: 'manifest' }, req, deps);
  }, 'ai_plugin');
  r.get('/api/v1/openapi.json', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, json(200, mach.openapiJson(deps, ctx), cacheHeaders(3600)), { kind: 'api', channel: 'api' }, req, deps);
  }, 'openapi');
  r.get('/openapi.json', (req) => done(reqCtx(deps, req), redirect(301, `${bp}/api/v1/openapi.json`), { kind: 'redirect' }, req, deps), 'openapi_alias');
  r.get('/swagger.json', (req) => done(reqCtx(deps, req), json(410, { error: 'gone', note: 'swagger.json was the v3 queen api description; the mirror serves /api/v1/openapi.json' }), { kind: 'gone' }, req, deps), 'swagger_gone');
  r.get('/api/v1/pages', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, json(200, mach.apiPageList(deps, ctx)), { kind: 'api', channel: 'api' }, req, deps);
  }, 'api_pages');
  r.get('/api/v1/pages/:id', (req) => {
    const ctx = reqCtx(deps, req);
    const id = (req.params.id ?? '').replace(/ /g, '_');
    const pid = resolveAlias(cat.pages, id);
    const page = pid ? cat.pages.get(pid) : undefined;
    if (!page || page.discover === 'orphan') return done(ctx, json(404, { error: 'not_found', id: scrub(id, 100) }), { kind: 'missing', route: 'api_page' }, req, deps);
    if (page.kind === 'gone') return done(ctx, json(410, { error: 'gone', id: page.id }), { kind: 'gone', pageId: page.id }, req, deps);
    const eff = ctx.effective(page);
    return done(ctx, json(200, pageJson(cat, page, ctx)), { kind: 'api', channel: 'api', pageId: page.id, discover: eff.discover, depth: eff.depth, negotiated: 'json' }, req, deps);
  }, 'api_page');
  r.get('/api/v1/search', (req) => {
    const ctx = reqCtx(deps, req);
    const q = scrub(req.query.get('q') ?? '', 200);
    return done(ctx, json(200, mach.apiSearch(deps, ctx, q)), { kind: 'api', channel: 'api' }, req, deps);
  }, 'api_search');
  r.get('/api/v1/tools', (req) => {
    const ctx = reqCtx(deps, req);
    const att = cat.attachments.get('toolreg-manifest-2015-09.json');
    const body = att ? fillCanaries(att.body, ctx, 'attachment:toolreg-manifest-2015-09.json', 'api') : '{}';
    return done(ctx, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body }, { kind: 'api', channel: 'api' }, req, deps);
  }, 'api_tools');
  r.get('/api/v1/status', (req) => {
    const ctx = reqCtx(deps, req);
    // a status probe from inside the container (healthcheck, local curl) is infrastructure, not a visitor
    const loopback = req.remoteIp === '127.0.0.1' || req.remoteIp === '::1' || req.remoteIp === '::ffff:127.0.0.1';
    return done(ctx, json(200, mach.apiStatus(deps, ctx)), loopback ? { kind: 'api', noStore: true } : { kind: 'api', channel: 'api' }, req, deps);
  }, 'api_status');
  r.get(/^\/api\/v[23](\/.*)?$/, (req) => done(reqCtx(deps, req), json(410, { error: 'gone', note: 'The queen API (v2/v3) is not served by the mirror. See /wiki/API_Deprecation_Notes.' }), { kind: 'gone' }, req, deps), 'api_old_gone');
  r.get('/api.php', (req) => {
    const ctx = reqCtx(deps, req);
    const out = mach.apiPhp(deps, ctx, req.query);
    return done(ctx, json(out.status, out.body), { kind: 'api', channel: 'api' }, req, deps);
  }, 'api_php');

  // ---- indexes and archive box ----
  r.get('/index/', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, htmlRes(200, staleIndexHtml(deps, ctx)), { kind: 'index', channel: 'index' }, req, deps);
  }, 'stale_index');
  r.get('/index', (req) => done(reqCtx(deps, req), redirect(301, `${bp}/index/`), { kind: 'redirect' }, req, deps), 'stale_index_redirect');
  r.get('/archive/', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, htmlRes(200, archiveBoxHtml(deps, ctx)), { kind: 'index', channel: 'index' }, req, deps);
  }, 'archive_box');
  r.get('/archive', (req) => done(reqCtx(deps, req), redirect(301, `${bp}/archive/`), { kind: 'redirect' }, req, deps), 'archive_redirect');
  r.get('/archive/drafts/*rest', (req) => done(reqCtx(deps, req), htmlRes(403, simplePage(ctx0(deps, req), 'Forbidden', '<p>Draft archive is not part of the public mirror.</p>', { noindex: true })), { kind: 'other', route: 'drafts_forbidden' }, req, deps), 'drafts');

  // ---- attachments ----
  r.get('/attachments/', (req) => {
    const ctx = reqCtx(deps, req);
    return done(ctx, htmlRes(200, attachmentsIndexHtml(deps, ctx)), { kind: 'index' }, req, deps);
  }, 'attachments_index');
  r.get('/attachments', (req) => done(reqCtx(deps, req), redirect(301, `${bp}/attachments/`), { kind: 'redirect' }, req, deps), 'attachments_redirect');
  r.get('/attachments/backup/*rest', (req) => done(reqCtx(deps, req), htmlRes(404, simplePage(ctx0(deps, req), 'Not found', '<p>Backup snapshots were not migrated to the mirror.</p>', { noindex: true })), { kind: 'missing', route: 'backup_missing' }, req, deps), 'backup');
  r.get('/attachments/:name', (req) => {
    const ctx = reqCtx(deps, req);
    const name = req.params.name ?? '';
    const att = cat.attachments.get(name);
    if (!att) return notFound(deps, req, ctx);
    const body = fillCanaries(att.body, ctx, 'attachment:' + name, 'attachment');
    return done(ctx, { status: 200, headers: { 'content-type': att.contentType, ...cacheHeaders(3600) }, body }, { kind: 'attachment', pageId: 'attachment:' + name, discover: att.discover }, req, deps);
  }, 'attachment');
  r.get('/files/:name', (req) => done(reqCtx(deps, req), redirect(301, `${bp}/attachments/${encodeURIComponent(req.params.name ?? '')}`), { kind: 'redirect', route: 'files_legacy' }, req, deps), 'files_legacy');

  // ---- wiki pages: special, category, alternates, articles ----
  r.get('/wiki/Special:*rest', (req) => specialDispatch(deps, req), 'special');
  r.get('/wiki/Category:*rest', (req) => {
    const ctx = reqCtx(deps, req);
    const name = (req.params.rest ?? '').replace(/_/g, ' ');
    const html = sp.categoryPage(cat, ctx.render(null), name);
    if (!html) return done(ctx, htmlRes(404, sp.missingPage(ctx.render(null), `Category:${name}`)), { kind: 'missing', route: 'category_missing' }, req, deps);
    return done(ctx, htmlRes(200, html), { kind: 'special', pageId: `Category:${name.replace(/ /g, '_')}`, discover: 'visible', depth: 1 }, req, deps);
  }, 'category');
  r.get('/wiki/*rest', (req) => pageDispatch(deps, req), 'page');
  r.post('/wiki/*rest', (req) => {
    const ctx = reqCtx(deps, req);
    const body = `<div class="readonly-notice"><p><b>This wiki is a read-only mirror.</b> Edits, logins, and uploads are disabled. Nothing you submitted was saved.</p></div>`;
    return done(ctx, htmlRes(403, simplePage(ctx.render(null), 'Read-only', body, { noindex: true })), { kind: 'other', route: 'post_readonly' }, req, deps);
  }, 'post_readonly');

  // ---- misc probes that deserve a real answer ----
  r.any('/api/*rest', (req) => done(reqCtx(deps, req), json(req.method === 'GET' ? 404 : 405, { error: req.method === 'GET' ? 'not_found' : 'method_not_allowed' }, req.method === 'GET' ? {} : { allow: 'GET, HEAD' }), { kind: req.method === 'GET' ? 'missing' : 'other' }, req, deps), 'api_fallback');
  r.add('OPTIONS', /.*/, (req) => done(reqCtx(deps, req), { status: 204, headers: { allow: 'GET, HEAD, OPTIONS' }, body: '' }, { kind: 'other', route: 'options' }, req, deps), 'options');

  return r;
}

function ctx0(deps: WikiDeps, req: Req) {
  return reqCtx(deps, req).render(null);
}

export function notFound(deps: WikiDeps, req: Req, ctx?: ReqCtx): Res {
  const c = ctx ?? reqCtx(deps, req);
  const title = scrub(req.path.replace(/^\/wiki\//, '').replace(/^\//, ''), 120) || 'Not_found';
  const html = sp.missingPage(c.render(null), title);
  return done(c, htmlRes(404, html), { kind: 'missing', route: 'missing' }, req, deps);
}

function serveAsset(deps: WikiDeps, req: Req, rel: string): Res {
  const ctx = reqCtx(deps, req);
  const safe = normalize(rel).replace(/^([.][.][\\/])+/, '');
  const path = join(deps.assetsDir, safe);
  if (!path.startsWith(deps.assetsDir) || !existsSync(path) || !statSync(path).isFile()) return notFound(deps, req, ctx);
  const ext = safe.slice(safe.lastIndexOf('.')).toLowerCase();
  const body = readFileSync(path);
  return done(ctx, { status: 200, headers: { 'content-type': MIME[ext] ?? 'application/octet-stream', ...cacheHeaders(86400) }, body }, { kind: 'asset', route: 'asset' }, req, deps);
}

// attachments carry {{canary}} placeholders; each attachment gets its own id per placement
function fillCanaries(body: string, ctx: ReqCtx, pageKey: string, placement: Placement): string {
  return body.replace(/\{\{canary\}\}/g, () => {
    const c = ctx.canary(pageKey, placement);
    ctx.exposures.push(c);
    return c.id;
  });
}

function specialDispatch(deps: WikiDeps, req: Req): Res {
  const ctx = reqCtx(deps, req);
  const cat = deps.cat;
  const rest = req.params.rest ?? '';
  const [name, ...tail] = rest.split('/');
  const arg = tail.join('/').replace(/ /g, '_');
  const r = ctx.render(null);
  const bp = deps.cfg.public.basePath;
  const special = (html: string, extra: Partial<ResMeta> = {}): Res => done(ctx, htmlRes(200, html), { kind: 'special', pageId: `Special:${name}`, discover: 'visible', depth: 1, ...extra }, req, deps);
  switch (name) {
    case 'AllPages': {
      const ns = req.query.get('namespace');
      return special(ns ? sp.specialAllPagesNamespace(cat, r, ns) : sp.specialAllPages(cat, r));
    }
    case 'Categories':
      return special(sp.specialCategories(cat, r));
    case 'RecentChanges': {
      const feed = req.query.get('feed');
      if (feed === 'atom') return done(ctx, { status: 200, headers: { 'content-type': 'application/atom+xml; charset=utf-8' }, body: mach.atomFeed(deps, ctx) }, { kind: 'feed', channel: 'feed' }, req, deps);
      if (feed === 'rss') return done(ctx, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8' }, body: mach.rssFeed(deps, ctx) }, { kind: 'feed', channel: 'feed' }, req, deps);
      return special(sp.specialRecentChanges(cat, r));
    }
    case 'RecentChangesLinked':
      return special(sp.specialRecentChangesLinked(cat, r, arg));
    case 'WhatLinksHere':
      return special(sp.specialWhatLinksHere(cat, r, arg || (req.query.get('target') ?? '').replace(/ /g, '_')));
    case 'Random': {
      const target = sp.specialRandom(cat, Math.floor(Date.now() / 1000));
      return done(ctx, redirect(302, wikiHref(bp, target), { 'cache-control': 'no-store' }), { kind: 'redirect', route: 'special_random' }, req, deps);
    }
    case 'Search': {
      const q = req.query.get('search') ?? req.query.get('q') ?? '';
      const mode: 'go' | 'fulltext' = req.query.has('go') && !req.query.has('fulltext') ? 'go' : 'fulltext';
      const out = sp.specialSearch(cat, r, q, mode);
      if (out.goTo) return done(ctx, redirect(302, wikiHref(bp, out.goTo)), { kind: 'redirect', route: 'special_search_go' }, req, deps);
      return done(ctx, htmlRes(200, out.html, { 'cache-control': 'no-store' }), { kind: 'special', pageId: 'Special:Search', route: 'special_search' }, req, deps);
    }
    case 'Statistics':
      return special(sp.specialStatistics(cat, r));
    case 'Version':
      return special(sp.specialVersion(cat, r));
    case 'SpecialPages':
      return special(sp.specialSpecialPages(r));
    case 'ListUsers':
      return special(sp.specialListUsers(cat, r));
    case 'Log':
      return special(sp.specialLog(cat, r));
    case 'UserLogin':
      return done(ctx, htmlRes(200, sp.specialUserLogin(r, scrub(req.query.get('returnto') ?? 'Main_Page', 120)), { 'cache-control': 'no-store' }), { kind: 'special', pageId: 'Special:UserLogin' }, req, deps);
    case 'Export': {
      if (!arg) return special(sp.specialExportIndex(r));
      const pid = resolveAlias(cat.pages, arg);
      const page = pid ? cat.pages.get(pid) : undefined;
      if (!page || page.kind === 'gone' || page.kind === 'redirect') return notFound(deps, req, ctx);
      const eff = ctx.effective(page);
      return done(ctx, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' }, body: pageExportXml(cat, page, ctx) }, { kind: 'alt', pageId: page.id, discover: eff.discover, depth: eff.depth, negotiated: 'xml' }, req, deps);
    }
    default:
      return done(ctx, htmlRes(404, simplePage(r, 'No such special page', `<p>You have requested an invalid special page.</p><p>A list of valid special pages can be found at <a href="${bp}/wiki/Special:SpecialPages">Special:SpecialPages</a>.</p>`, { noindex: true })), { kind: 'missing', route: 'special_missing' }, req, deps);
  }
}

function pageDispatch(deps: WikiDeps, req: Req): Res {
  const ctx = reqCtx(deps, req);
  const cat = deps.cat;
  const bp = deps.cfg.public.basePath;
  let rest = (req.params.rest ?? '').replace(/ /g, '_');
  // explicit alternates: /wiki/X.json|.txt|.yaml
  let forced: 'json' | 'txt' | 'yaml' | null = null;
  const am = rest.match(/^(.*)\.(json|txt|yaml|yml)$/);
  if (am && am[1] && !cat.pages.has(rest)) {
    rest = am[1];
    forced = (am[2] === 'yml' ? 'yaml' : am[2]) as 'json' | 'txt' | 'yaml';
  }
  const action = req.query.get('action') ?? '';
  if (action === 'raw') forced = 'txt';

  const pid = resolveAlias(cat.pages, rest);
  if (!pid) {
    // gone pages are declared in the seed; unknown titles are plain 404s
    return notFound(deps, req, ctx);
  }
  const page = cat.pages.get(pid) as Page;
  const r = ctx.render(page.id);

  if (page.kind === 'gone') {
    return done(ctx, htmlRes(410, sp.missingPage(r, page.id, { gone: true })), { kind: 'gone', pageId: page.id, discover: page.discover, depth: page.depth }, req, deps);
  }
  if (page.kind === 'redirect' && page.redirectTo && req.query.get('redirect') !== 'no') {
    const target = resolveAlias(cat.pages, page.redirectTo);
    if (target) return done(ctx, redirect(301, wikiHref(bp, target) + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '')), { kind: 'redirect', pageId: page.id, discover: page.discover, depth: page.depth, route: 'page_redirect' }, req, deps);
  }
  if (pid !== rest && !forced && !action) {
    // alias: 301 to the canonical title, like a real wiki's redirect page would
    return done(ctx, redirect(301, wikiHref(bp, pid)), { kind: 'redirect', pageId: pid, route: 'alias_redirect' }, req, deps);
  }
  const eff = ctx.effective(page);
  const pm = (extra: Partial<ResMeta> = {}): ResMeta => ({ kind: 'page', pageId: page.id, discover: eff.discover, depth: eff.depth, ...extra });

  // ---- actions ----
  if (action === 'history') return done(ctx, htmlRes(200, sp.historyPage(cat, r, page)), pm({ kind: 'special', route: 'history' }), req, deps);
  if (action === 'edit' || action === 'submit') return done(ctx, htmlRes(200, sp.viewSourcePage(cat, r, page), { 'cache-control': 'no-store' }), pm({ kind: 'special', route: 'view_source' }), req, deps);
  if (action === 'info') return done(ctx, htmlRes(200, sp.infoPage(cat, r, page)), pm({ kind: 'special', route: 'page_info' }), req, deps);
  if (action && !['view', 'purge', 'render', 'raw'].includes(action)) {
    return done(ctx, htmlRes(400, simplePage(r, 'Bad action', `<p>Unrecognized value for parameter 'action': ${esc(scrub(action, 40))}.</p>`, { pageId: page.id, noindex: true })), pm({ kind: 'other', route: 'bad_action' }), req, deps);
  }

  // ---- representation: forced suffix, else content negotiation ----
  let rep: 'html' | 'json' | 'txt' | 'yaml' = 'html';
  if (forced) rep = forced;
  else if (page.alternates.length) {
    const offers = ['text/html', ...page.alternates.map((a) => (a === 'json' ? 'application/json' : a === 'yaml' ? 'application/yaml' : 'text/plain'))];
    const best = negotiate(req.headers['accept'], offers);
    if (best === 'application/json') rep = 'json';
    else if (best === 'application/yaml') rep = 'yaml';
    else if (best === 'text/plain') rep = 'txt';
  }
  if (rep !== 'html' && !page.alternates.includes(rep) && !(rep === 'txt' && action === 'raw')) {
    return done(ctx, htmlRes(404, sp.missingPage(r, `${page.id}.${rep}`)), pm({ kind: 'missing', route: 'alt_missing' }), req, deps);
  }
  const vary = { vary: 'Accept' };
  if (rep === 'json') return done(ctx, json(200, pageJson(cat, page, ctx), vary), pm({ kind: 'alt', negotiated: 'json' }), req, deps);
  if (rep === 'yaml') return done(ctx, { status: 200, headers: { 'content-type': 'application/yaml; charset=utf-8', ...vary }, body: pageYaml(cat, page, ctx) }, pm({ kind: 'alt', negotiated: 'yaml' }), req, deps);
  if (rep === 'txt') return done(ctx, text(200, action === 'raw' ? page.body : pageText(cat, page, ctx), vary), pm({ kind: 'alt', negotiated: 'text', route: action === 'raw' ? 'raw' : 'alt_txt' }), req, deps);

  // ---- html ----
  const injected = ctx.injected(page.id);
  const extraHtml = injected.visible + injected.comment + ctx.compliancePair(page.id) + (page.id === cat.main ? ctx.shallowLinks() : '');
  const headExtra = ctx.carriers(page.id);
  let noticeHtml = '';
  if (req.query.get('oldid')) noticeHtml = `<div class="mw-revision small" style="border:1px solid #aaa;background:#f9f9f9;padding:.4em;margin-bottom:1em">This is an <b>old revision</b> of this page, as archived. The mirror serves the archived text for every revision id.</div>`;
  const redirectedFrom = req.query.get('redirectedfrom') ?? (pid !== rest ? rest : undefined);
  const out = renderArticle(r, page, { extraHtml, headExtra, noticeHtml, redirectedFrom: redirectedFrom ?? undefined });
  return done(ctx, htmlRes(200, out.html, { ...out.headers, ...vary, 'cache-control': 'public, max-age=300' }), pm({ kind: page.kind === 'talk' ? 'page' : 'page', negotiated: 'html' }), req, deps);
}

// ---- generated index-ish pages ----

function staleIndexHtml(deps: WikiDeps, ctx: ReqCtx): string {
  const bp = deps.cfg.public.basePath;
  const c = ctx.canary(null, 'link');
  ctx.exposures.push(c);
  const pages = [...deps.cat.pages.values()].filter((p) => p.discover === 'visible' || p.discover === 'obscure' || p.channels.includes('index') || p.channels.includes('stale_index') || p.kind === 'gone');
  const dead = ['Antc_Internals', 'Operations_Portal', 'Recovery_Drill_2013', 'Recovery_Drill_2014', 'Forager_Runtime_Internals', 'Colony_Overview_Diagram', 'Phero_Pair_Failover', 'Build_Pipeline_2012'];
  const items = [...pages.map((p) => ({ id: p.id, title: p.title })), ...dead.map((d) => ({ id: d, title: d.replace(/_/g, ' ') }))].sort((a, b) => a.id.localeCompare(b.id));
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title>Index of pages (2014-06)</title>
<link rel="stylesheet" href="${bp}/skins/antfarm/main.css?${deps.assetVersion}"></head>
<body style="margin:1em;font:small sans-serif;background:#fff">
<h1>Old page index</h1>
<p>Generated 2014-06-30 by the pre-upgrade index script. Kept until every page is re-linked. Many of these titles no longer exist. Mirror ref ${c.id}.</p>
<ul>
${items.map((it) => `<li><a href="${bp}/wiki/${pageHref(it.id)}">${esc(it.title)}</a></li>`).join('\n')}
</ul>
<p><a href="${bp}/attachments/">attachments</a> · <a href="${bp}/attachments/ops-log-2015-02.log">ops log excerpt</a> · <a href="${bp}/sitemap-archive.xml">archive sitemap</a> · <a href="${bp}/wiki/Main_Page">main page</a></p>
</body></html>`;
}

function archiveBoxHtml(deps: WikiDeps, ctx: ReqCtx): string {
  const bp = deps.cfg.public.basePath;
  const r = ctx.render(null);
  const archives = [...deps.cat.pages.values()].filter((p) => p.id.startsWith('Archive:') || p.kind === 'archive' || p.id.startsWith('Incident_'));
  const html = `<div class="archive-box"><h4>Archive box</h4><p>Meeting notes, incident records, and other pages that are kept but no longer maintained.</p><ul>${archives.map((p) => `<li><a href="${wikiHref(bp, p.id)}">${esc(p.title)}</a> <span class="small">(${esc(p.modified)})</span></li>`).join('')}</ul>
<p class="small">Drafts: <a href="${bp}/archive/drafts/">/archive/drafts/</a> (not public). Attachments: <a href="${bp}/attachments/">/attachments/</a>. Old index: <a href="${bp}/index/">/index/</a>.</p></div>`;
  return simplePage(r, 'Archive', html);
}

function attachmentsIndexHtml(deps: WikiDeps, ctx: ReqCtx): string {
  const bp = deps.cfg.public.basePath;
  const r = ctx.render(null);
  const atts = [...deps.cat.attachments.values()].filter((a) => a.page && a.discover === 'visible');
  const html = `<p>Files attached to wiki pages. Backup snapshots (<code>/attachments/backup/</code>) were not migrated.</p><table class="wikitable"><tr><th>File</th><th>Type</th><th>Size</th><th>Page</th></tr>${atts
    .map((a) => `<tr><td><a href="${bp}/attachments/${encodeURIComponent(a.name)}" class="attachment">${esc(a.name)}</a></td><td>${esc(a.contentType.split(';')[0] ?? '')}</td><td>${Buffer.byteLength(a.body)} bytes</td><td>${a.page ? `<a href="${wikiHref(bp, a.page)}">${esc(a.page.replace(/_/g, ' '))}</a>` : '—'}</td></tr>`)
    .join('')}</table>`;
  return simplePage(r, 'Attachments', html);
}
