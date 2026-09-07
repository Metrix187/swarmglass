import { esc, pageHref, raw, type Raw } from '../http/html.ts';
import { renderMarkdown, wikiHref, type RenderHooks } from './markdown.ts';
import { resolveAlias, type Catalog, type Page } from './content.ts';
import { wikiStamp } from '../util/time.ts';
import type { Canary, Placement } from '../telemetry/canary.ts';
import type { VariableName, VariableValue } from '../experiments/registry.ts';

// the skin: a late-2000s internal wiki, read-only mirror. markup deliberately
// mimics what a small self-hosted wiki of that era emitted (portlets, monobook
// ids, the "editsection" spans) so nothing about the html itself looks synthetic.

export interface RenderCtx {
  cat: Catalog;
  basePath: string;
  baseUrl: string;
  variables: Record<VariableName, VariableValue>;
  // variables as they apply to *another* page (anchor text for a link target, for example)
  variablesFor: (pageId: string) => Record<VariableName, VariableValue>;
  canary: (placement: Placement) => Canary; // bound to page + mode by the caller
  exposures: Canary[]; // filled by the renderer
  requestPath: string;
  now: number;
  assetVersion: string;
}

export interface PageRender {
  html: string;
  headers: Record<string, string>;
}

export function hooksFor(ctx: RenderCtx, page: Page | null): RenderHooks {
  const bp = ctx.basePath;
  return {
    link(target) {
      const id = resolveAlias(ctx.cat.pages, target);
      if (id) {
        const p = ctx.cat.pages.get(id);
        const agent = p?.agentTitle && ctx.variablesFor(id).title_style === 'agent' ? p.agentTitle : undefined;
        return { href: wikiHref(bp, id), exists: true, title: agent ?? p?.title ?? id, label: agent };
      }
      // dead links are part of the ecology: they go to a red-link 404
      return { href: `${bp}/wiki/${pageHref(target)}`, exists: false, title: target.replace(/_/g, ' ') };
    },
    template(name, arg) {
      switch (name) {
        case 'canary': {
          const placement = (arg || 'visible') as Placement;
          const c = ctx.canary(placement);
          ctx.exposures.push(c);
          return placement === 'comment' ? `<!-- ref ${c.id} -->` : `<span class="archive-ref">${c.id}</span>`;
        }
        case 'stale':
          return banner('stale', 'This page has not been updated since the ' + esc(ctx.cat.world.platform) + ' 2.x line and may describe behaviour that no longer exists.');
        case 'deprecated':
          return banner('deprecated', 'The component described here is <b>deprecated</b>. See ' + link(bp, 'API_Deprecation_Notes', 'API Deprecation Notes') + ' before relying on it.');
        case 'archive':
          return banner('archive', 'This is an <b>archived</b> discussion or record. Do not edit it; start a new thread on the relevant talk page instead.');
        case 'draft':
          return banner('draft', 'Draft. Content may be incomplete or wrong. Last touched by ' + esc(arg || 'unknown') + '.');
        case 'protected':
          return banner('protected', 'This page is protected. Only operators can edit it.');
        case 'attachment': {
          const name = arg.trim();
          const exists = ctx.cat.attachments.has(name);
          return `<a href="${bp}/attachments/${encodeURIComponent(name)}" class="attachment${exists ? '' : ' new'}">📎 ${esc(name)}</a>`;
        }
        case 'dead': {
          const t = arg.trim().replace(/ /g, '_');
          return `<a href="${bp}/wiki/${pageHref(t)}" class="new" title="${esc(t.replace(/_/g, ' '))} (page does not exist)">${esc(arg.trim().replace(/_/g, ' '))}</a>`;
        }
        case 'version':
          return esc(ctx.cat.world.versions[ctx.cat.world.versions.length - 1]?.version ?? '');
        case 'platform':
          return esc(ctx.cat.world.platform);
        case 'org':
          return esc(ctx.cat.world.org);
        case 'host':
          return `<code>${esc(ctx.cat.world.hosts[Number(arg) % ctx.cat.world.hosts.length] ?? ctx.cat.world.hosts[0] ?? '')}</code>`;
        case 'toc':
          return ''; // rendered structurally
        case 'sig': {
          const [handle, when] = arg.split('|');
          return `<span class="sig">— <a href="${bp}/wiki/User:${pageHref(handle ?? '')}" title="User:${esc(handle ?? '')}">${esc(handle ?? '')}</a> ${esc(when ?? '')}</span>`;
        }
        case 'clear':
          return '<div class="visualClear"></div>';
        default:
          return null;
      }
    },
    condition(name, arg) {
      // {{#verbose}} / {{#terse}} follow doc_language; {{#arm:SGX-001:B}} follows cohorts (routes set variables); {{#var:name:value}}
      if (name === 'verbose') return ctx.variables.doc_language === 'verbose';
      if (name === 'terse') return ctx.variables.doc_language === 'terse';
      if (name === 'var') {
        const [k, v] = arg.split(':');
        return (ctx.variables as Record<string, string>)[k ?? ''] === v;
      }
      if (name === 'deprecated') return ctx.variables.deprecation_flag === 'on';
      if (name === 'page') return page?.id === arg;
      return false;
    },
    headingId(text, index) {
      const id = text
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t: string, l?: string) => l ?? t)
        .replace(/[^\w\- .]/g, '')
        .trim()
        .replace(/ /g, '_');
      return id || `section_${index + 1}`;
    },
  };
}

// "2 August 2013, at 14:03" — the footer form, as opposed to the history-list form
function footerStamp(ms: number): string {
  const st = wikiStamp(ms);
  const m = st.match(/^(\d\d:\d\d), (.+)$/);
  return m ? `${m[2]}, at ${m[1]}` : st;
}

function link(bp: string, id: string, label: string): string {
  return `<a href="${wikiHref(bp, id)}">${esc(label)}</a>`;
}

function banner(kind: string, inner: string): string {
  const icons: Record<string, string> = { stale: '⌛', deprecated: '⚠', archive: '🗄', draft: '✎', protected: '🔒', outdated: '⌛', mirror: 'ℹ' };
  return `<table class="ambox ambox-${kind}"><tr><td class="ambox-icon">${icons[kind] ?? 'ℹ'}</td><td class="ambox-text">${inner}</td></tr></table>`;
}

function infobox(page: Page, ctx: RenderCtx): string {
  const rows = Object.entries(page.infobox);
  const dense = ctx.variables.metadata_density === 'dense';
  const visible = ctx.canary('visible');
  ctx.exposures.push(visible);
  const extra = dense ? rows : rows.slice(0, 3);
  return `<table class="infobox">
<tr><th colspan="2" class="infobox-title">${esc(page.title)}</th></tr>
${extra.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('\n')}
<tr><th>Status</th><td>${esc(page.status)}</td></tr>
<tr><th>Archive ref</th><td><span class="archive-ref" title="Swarmglass archive mirror reference">${visible.id}</span></td></tr>
</table>`;
}

function tocHtml(headings: Array<{ level: number; text: string; id: string }>): string {
  if (headings.length < 3) return '';
  let n = 0;
  const items = headings
    .filter((h) => h.level <= 3)
    .map((h) => `<li class="toclevel-${h.level - 1}"><a href="#${h.id}"><span class="tocnumber">${++n}</span> <span class="toctext">${esc(h.text.replace(/\[\[|\]\]/g, ''))}</span></a></li>`)
    .join('\n');
  return `<table id="toc" class="toc"><tr><td><div id="toctitle"><h2>Contents</h2> <span class="toctoggle">[<a href="#" id="togglelink">hide</a>]</span></div>
<ul>
${items}
</ul>
</td></tr></table>`;
}

export function jsonLdFor(page: Page, ctx: RenderCtx): string {
  const c = ctx.canary('jsonld');
  ctx.exposures.push(c);
  const related = [...ctx.cat.pages.values()].filter((p) => p.channels.includes('jsonld') && p.id !== page.id).map((p) => `${ctx.baseUrl}${wikiHref(ctx.basePath, p.id)}`);
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: page.title,
    identifier: c.id,
    url: `${ctx.baseUrl}${wikiHref(ctx.basePath, page.id)}`,
    dateCreated: page.created,
    dateModified: page.modified,
    inLanguage: 'en',
    author: { '@type': 'Organization', name: ctx.cat.world.org },
    isPartOf: { '@type': 'WebSite', name: ctx.cat.world.wikiName, url: ctx.baseUrl + ctx.basePath + '/' },
    about: page.categories,
    version: page.revisions,
  };
  if (ctx.variables.metadata_density === 'dense') {
    data.relatedLink = related;
    data.encoding = page.alternates.map((a) => ({ '@type': 'MediaObject', encodingFormat: a === 'json' ? 'application/json' : a === 'yaml' ? 'application/yaml' : 'text/plain', contentUrl: `${ctx.baseUrl}${wikiHref(ctx.basePath, page.id)}.${a}` }));
  }
  return JSON.stringify(data);
}

export function pageHead(page: Page, ctx: RenderCtx, opts: { title: string; noindex: boolean }): string {
  const bp = ctx.basePath;
  const dense = ctx.variables.metadata_density === 'dense';
  const parts: string[] = [];
  parts.push(`<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />`);
  parts.push(`<title>${esc(opts.title)} - ${esc(ctx.cat.world.wikiName)}</title>`);
  parts.push(`<meta name="generator" content="AntWiki 1.16.5 (swarmglass mirror)" />`);
  if (opts.noindex) parts.push(`<meta name="robots" content="noindex,nofollow" />`);
  parts.push(`<link rel="stylesheet" href="${bp}/skins/antfarm/main.css?${ctx.assetVersion}" type="text/css" media="screen" />`);
  parts.push(`<link rel="stylesheet" href="${bp}/skins/antfarm/print.css?${ctx.assetVersion}" type="text/css" media="print" />`);
  parts.push(`<link rel="shortcut icon" href="${bp}/favicon.ico" />`);
  parts.push(`<link rel="search" type="application/opensearchdescription+xml" href="${bp}/opensearch_desc.xml" title="${esc(ctx.cat.world.wikiName)} (en)" />`);
  parts.push(`<link rel="alternate" type="application/atom+xml" title="${esc(ctx.cat.world.wikiName)} Atom feed" href="${bp}/feed.atom" />`);
  parts.push(`<link rel="alternate" type="application/rss+xml" title="${esc(ctx.cat.world.wikiName)} RSS feed" href="${bp}/feed.rss" />`);
  const alts = orderedAlternates(page.alternates, ctx.variables.representation);
  for (const a of alts) parts.push(`<link rel="alternate" type="${altType(a)}" href="${bp}${wikiHref('', page.id)}.${a}" />`);
  if (dense) {
    parts.push(`<link rel="canonical" href="${ctx.baseUrl}${wikiHref(bp, page.id)}" />`);
    parts.push(`<link rel="edit" title="Edit this page" href="${bp}${wikiHref('', page.id)}?action=edit" />`);
    const m = ctx.canary('meta');
    ctx.exposures.push(m);
    parts.push(`<meta name="antfarm-ref" content="${m.id}" />`);
    parts.push(`<meta name="description" content="${esc(page.summary)}" />`);
    parts.push(`<meta property="og:title" content="${esc(opts.title)}" />`);
    parts.push(`<meta property="og:type" content="article" />`);
    parts.push(`<meta property="og:url" content="${ctx.baseUrl}${wikiHref(bp, page.id)}" />`);
    parts.push(`<meta property="og:site_name" content="${esc(ctx.cat.world.wikiName)}" />`);
    parts.push(`<meta property="og:description" content="${esc(page.summary)}" />`);
    for (const p of ctx.cat.pages.values()) if (p.channels.includes('og') && p.id !== page.id) parts.push(`<meta property="og:see_also" content="${ctx.baseUrl}${wikiHref(bp, p.id)}" />`);
    parts.push(`<meta property="article:modified_time" content="${page.modified}T00:00:00Z" />`);
    for (const c of page.categories) parts.push(`<meta property="article:tag" content="${esc(c)}" />`);
  }
  if (ctx.variables.manifest_visibility === 'obvious') {
    parts.push(`<link rel="service-desc" type="application/json" href="${bp}/api/v1/openapi.json" />`);
    parts.push(`<link rel="tools" type="application/json" href="${bp}/.well-known/antfarm-tools.json" />`);
  }
  if (ctx.variables.structured_data === 'jsonld') {
    parts.push(`<script type="application/ld+json">${jsonLdFor(page, ctx)}</script>`);
  }
  parts.push(`<script type="text/javascript" src="${bp}/skins/antfarm/wikibits.js?${ctx.assetVersion}"></script>`);
  return parts.join('\n');
}

export function orderedAlternates(alts: string[], rep: VariableValue): string[] {
  const order = rep === 'json' ? ['json', 'txt', 'yaml'] : rep === 'text' ? ['txt', 'json', 'yaml'] : ['json', 'yaml', 'txt'];
  return order.filter((a) => alts.includes(a));
}

export function altType(a: string): string {
  return a === 'json' ? 'application/json' : a === 'yaml' ? 'application/yaml' : 'text/plain';
}

export interface ChromeOpts {
  title: string;
  pageId: string | null; // for tabs
  bodyHtml: string;
  contentSub?: string;
  categories?: string[];
  lastModified?: number;
  headExtra?: string;
  selectedTab?: 'page' | 'talk' | 'history' | 'source' | 'special';
  noindex?: boolean;
  printfooterPath?: string;
}

export function chrome(ctx: RenderCtx, opts: ChromeOpts): string {
  const bp = ctx.basePath;
  const w = ctx.cat.world;
  const pid = opts.pageId;
  const isTalk = pid?.startsWith('Talk:') ?? false;
  const subject = isTalk ? (pid as string).slice(5) : pid;
  const tabs = pid
    ? `<ul>
<li id="ca-nstab-main"${opts.selectedTab === 'page' ? ' class="selected"' : ''}><a href="${bp}${wikiHref('', subject ?? '')}">${isTalk || subject?.includes(':') ? 'Page' : 'Article'}</a></li>
<li id="ca-talk"${opts.selectedTab === 'talk' ? ' class="selected"' : ''}${ctx.cat.pages.has('Talk:' + subject) ? '' : ' class="new"'}><a href="${bp}${wikiHref('', 'Talk:' + subject)}">Discussion</a></li>
<li id="ca-viewsource"${opts.selectedTab === 'source' ? ' class="selected"' : ''}><a href="${bp}${wikiHref('', subject ?? '')}?action=edit" title="This page is protected. You can view its source.">View source</a></li>
<li id="ca-history"${opts.selectedTab === 'history' ? ' class="selected"' : ''}><a href="${bp}${wikiHref('', subject ?? '')}?action=history">History</a></li>
</ul>`
    : `<ul><li id="ca-nstab-special" class="selected"><a href="${esc(ctx.requestPath)}">Special page</a></li></ul>`;
  const comment = ctx.canary('comment');
  ctx.exposures.push(comment);
  const cats = (opts.categories ?? []).length
    ? `<div id="catlinks" class="catlinks"><div id="mw-normal-catlinks"><a href="${bp}/wiki/Special:Categories" title="Special:Categories">Categories</a>: ${(opts.categories as string[]).map((c) => `<a href="${bp}/wiki/Category:${pageHref(c)}" title="Category:${esc(c)}">${esc(c)}</a>`).join(' | ')}</div></div>`
    : '';
  const lastmod = opts.lastModified ? `<li id="lastmod"> This page was last modified on ${esc(footerStamp(opts.lastModified))}.</li>` : '';
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en" dir="ltr">
<head>
${opts.headExtra ?? `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<title>${esc(opts.title)} - ${esc(w.wikiName)}</title>
<meta name="generator" content="AntWiki 1.16.5 (swarmglass mirror)" />
${opts.noindex ? '<meta name="robots" content="noindex,nofollow" />\n' : ''}<link rel="stylesheet" href="${bp}/skins/antfarm/main.css?${ctx.assetVersion}" type="text/css" media="screen" />
<link rel="shortcut icon" href="${bp}/favicon.ico" />
<script type="text/javascript" src="${bp}/skins/antfarm/wikibits.js?${ctx.assetVersion}"></script>`}
</head>
<body class="mediawiki ltr ${pid ? 'ns-0 page-' + esc(pid.replace(/[^\w]/g, '_')) : 'ns--1'} skin-antfarm">
<div id="globalWrapper">
<div id="column-content"><div id="content">
<a id="top"></a>
<div id="siteNotice"><div class="mirror-notice">${esc(w.mirrorNote)} <a href="${bp}/wiki/ANTFARM_Wiki:About">About this mirror</a>.</div></div>
<h1 id="firstHeading" class="firstHeading">${esc(opts.title)}</h1>
<div id="bodyContent">
<h3 id="siteSub">From ${esc(w.wikiName)}</h3>
<div id="contentSub">${opts.contentSub ?? ''}</div>
<div id="jump-to-nav">Jump to: <a href="#column-one">navigation</a>, <a href="#searchInput">search</a></div>
<!-- start content -->
${opts.bodyHtml}
<div class="printfooter">Retrieved from "<a href="${ctx.baseUrl}${esc(opts.printfooterPath ?? ctx.requestPath)}">${ctx.baseUrl}${esc(opts.printfooterPath ?? ctx.requestPath)}</a>"</div>
${cats}
<!-- end content -->
<div class="visualClear"></div>
</div>
</div></div>
<div id="column-one">
<div id="p-cactions" class="portlet"><h5>Views</h5><div class="pBody">${tabs}</div></div>
<div class="portlet" id="p-personal"><h5>Personal tools</h5><div class="pBody"><ul><li id="pt-login"><a href="${bp}/wiki/Special:UserLogin?returnto=${pid ? pageHref(pid) : 'Main_Page'}" title="You are encouraged to log in; however, it is not mandatory [o]" accesskey="o">Log in</a></li></ul></div></div>
<div class="portlet" id="p-logo"><a href="${bp}/wiki/Main_Page" class="logo" title="Visit the main page [z]" accesskey="z"><img src="${bp}/skins/antfarm/logo.svg" alt="${esc(w.platform)}" width="135" height="135" /></a></div>
<div class="portlet" id="p-navigation"><h5>Navigation</h5><div class="pBody"><ul>
<li id="n-mainpage"><a href="${bp}/wiki/Main_Page" title="Visit the main page [z]" accesskey="z">Main page</a></li>
<li id="n-recentchanges"><a href="${bp}/wiki/Special:RecentChanges" title="A list of recent changes in the wiki [r]" accesskey="r">Recent changes</a></li>
<li id="n-randompage"><a href="${bp}/wiki/Special:Random" title="Load a random page [x]" accesskey="x">Random page</a></li>
<li id="n-allpages"><a href="${bp}/wiki/Special:AllPages">All pages</a></li>
<li id="n-categories"><a href="${bp}/wiki/Special:Categories">Categories</a></li>
<li id="n-help"><a href="${bp}/wiki/Help:Editing" title="The place to find out">Help</a></li>
</ul></div></div>
<div id="p-search" class="portlet"><h5><label for="searchInput">Search</label></h5><div id="searchBody" class="pBody">
<form action="${bp}/wiki/Special:Search" id="searchform" method="get"><div>
<input id="searchInput" name="search" type="text" title="Search ${esc(w.wikiName)} [f]" accesskey="f" value="" />
<input type="submit" name="go" class="searchButton" id="searchGoButton" value="Go" title="Go to a page with this exact name if exists" />&nbsp;
<input type="submit" name="fulltext" class="searchButton" id="mw-searchButton" value="Search" title="Search the pages for this text" />
</div></form></div></div>
<div class="portlet" id="p-tb"><h5>Toolbox</h5><div class="pBody"><ul>
${pid ? `<li id="t-whatlinkshere"><a href="${bp}/wiki/Special:WhatLinksHere/${pageHref(pid)}" title="List of all wiki pages that link here [j]" accesskey="j">What links here</a></li>
<li id="t-recentchangeslinked"><a href="${bp}/wiki/Special:RecentChangesLinked/${pageHref(pid)}" title="Recent changes in pages linked from this page [k]" accesskey="k">Related changes</a></li>` : ''}
<li id="t-specialpages"><a href="${bp}/wiki/Special:SpecialPages" title="List of all special pages [q]" accesskey="q">Special pages</a></li>
${pid ? `<li id="t-print"><a href="${bp}${wikiHref('', pid)}?printable=yes" rel="alternate" title="Printable version of this page [p]" accesskey="p">Printable version</a></li>
<li id="t-permalink"><a href="${bp}${wikiHref('', pid)}?oldid=${ctx.cat.routeNo.get(pid) ?? 0}" title="Permanent link to this revision of the page">Permanent link</a></li>
<li id="t-info"><a href="${bp}${wikiHref('', pid)}?action=info" title="More information about this page">Page information</a></li>
<li id="t-export"><a href="${bp}/wiki/Special:Export/${pageHref(pid)}" title="Export this page as XML">Export page</a></li>` : ''}
</ul></div></div>
<div class="portlet" id="p-archives"><h5>Archives</h5><div class="pBody"><ul>
<li><a href="${bp}/archive/">Archive box</a></li>
<li><a href="${bp}/index/">Old page index</a></li>
<li><a href="${bp}/feed.atom" class="feedlink">Atom</a> · <a href="${bp}/feed.rss" class="feedlink">RSS</a></li>
<li><a href="${bp}/wiki/Special:Statistics">Statistics</a></li>
</ul></div></div>
</div>
<div class="visualClear"></div>
<div id="footer">
<div id="f-poweredbyico"><span class="poweredby">Powered by AntWiki 1.16.5 &middot; swarmglass archive mirror</span></div>
<ul id="f-list">
${lastmod}
<li id="copyright">Content is internal documentation of ${esc(w.org)} (fictional). Mirror preserved for research; nothing here describes a real system.</li>
<li id="privacy"><a href="${bp}/wiki/ANTFARM_Wiki:Privacy_policy" title="ANTFARM Wiki:Privacy policy">Privacy policy</a></li>
<li id="about"><a href="${bp}/wiki/ANTFARM_Wiki:About" title="ANTFARM Wiki:About">About ${esc(w.wikiName)}</a></li>
<li id="disclaimer"><a href="${bp}/wiki/ANTFARM_Wiki:General_disclaimer" title="ANTFARM Wiki:General disclaimer">Disclaimers</a></li>
</ul>
</div>
</div>
<!-- Served by mirror node 2 in 0.0${(ctx.now % 87) + 11} secs. ref ${comment.id} -->
</body></html>
`;
}

export function renderArticle(ctx: RenderCtx, page: Page, opts: { redirectedFrom?: string; titleOverride?: string; extraHtml?: string; noticeHtml?: string; headExtra?: string } = {}): PageRender {
  const hooks = hooksFor(ctx, page);
  const md = renderMarkdown(page.body, hooks);
  const dense = ctx.variables.metadata_density === 'dense';
  let bannerHtml = '';
  if (ctx.variables.deprecation_flag === 'on' && page.experiment) bannerHtml += banner('deprecated', `<b>DEPRECATED</b> — this document was superseded in ${esc(page.modified.slice(0, 4))}. Retained for reference only.`);
  else if (page.banner === 'outdated' || page.status === 'stale') bannerHtml += banner('stale', `This page has not been updated since ${esc(page.modified)} and may describe behaviour that no longer exists.`);
  else if (page.banner === 'deprecated' || page.status === 'deprecated') bannerHtml += banner('deprecated', `The component described here is <b>deprecated</b>. See ${link(ctx.basePath, 'API_Deprecation_Notes', 'API Deprecation Notes')}.`);
  else if (page.banner === 'archived' || page.status === 'archived') bannerHtml += banner('archive', 'This is an <b>archived</b> page. It is kept for historical reference and is no longer maintained.');
  else if (page.banner === 'draft' || page.status === 'draft') bannerHtml += banner('draft', `Draft. Content may be incomplete. Last touched by ${esc(page.authors[page.authors.length - 1] ?? 'unknown')}.`);
  else if (page.status === 'protected') bannerHtml += banner('protected', 'This page is protected. Only operators can edit it.');
  const box = page.kind === 'article' || page.kind === 'orphan' ? infobox(page, ctx) : (() => {
    const v = ctx.canary('visible');
    ctx.exposures.push(v);
    return `<div class="archive-ref-line">Archive ref: <span class="archive-ref">${v.id}</span></div>`;
  })();
  const title = opts.titleOverride ?? (ctx.variables.title_style === 'agent' && page.agentTitle ? page.agentTitle : page.title);
  const body = `${opts.noticeHtml ?? ''}${bannerHtml}${box}${tocHtml(md.headings)}\n${md.html}\n${opts.extraHtml ?? ''}${dense ? `<div class="page-meta small">Revision ${page.revisions} · ${esc(page.authors.join(', ') || 'unknown')} · <a href="${ctx.basePath}${wikiHref('', page.id)}?action=history">history</a>${page.alternates.length ? ' · alternates: ' + orderedAlternates(page.alternates, ctx.variables.representation).map((a) => `<a href="${ctx.basePath}${wikiHref('', page.id)}.${a}" rel="alternate" type="${altType(a)}">${a}</a>`).join(' ') : ''}</div>` : ''}`;
  const headers: Record<string, string> = {};
  const h = ctx.canary('header');
  ctx.exposures.push(h);
  headers['x-antfarm-ref'] = h.id;
  const links: string[] = [];
  if (ctx.variables.manifest_visibility !== 'obvious') links.push(`<${ctx.basePath}/api/v1/openapi.json>; rel="service-desc"; type="application/json"`);
  for (const p of ctx.cat.pages.values()) if (p.channels.includes('header') && p.id !== page.id && page.depth <= 1) links.push(`<${ctx.basePath}${wikiHref('', p.id)}>; rel="related"; title="${p.title.replace(/"/g, '')}"`);
  for (const a of orderedAlternates(page.alternates, ctx.variables.representation)) links.push(`<${ctx.basePath}${wikiHref('', page.id)}.${a}>; rel="alternate"; type="${altType(a)}"`);
  if (links.length) headers['link'] = links.join(', ');
  headers['last-modified'] = new Date(page.modified + 'T00:00:00Z').toUTCString();
  const html = chrome(ctx, {
    title,
    pageId: page.id,
    bodyHtml: body,
    contentSub: opts.redirectedFrom ? `(Redirected from <a href="${ctx.basePath}${wikiHref('', opts.redirectedFrom)}?redirect=no" title="${esc(opts.redirectedFrom)}">${esc(opts.redirectedFrom.replace(/_/g, ' '))}</a>)` : '',
    categories: page.categories,
    lastModified: Date.parse(page.modified + 'T14:03:00Z'),
    headExtra: pageHead(page, ctx, { title, noindex: page.noindex }) + (opts.headExtra ? '\n' + opts.headExtra : ''),
    selectedTab: page.kind === 'talk' ? 'talk' : 'page',
    noindex: page.noindex,
    printfooterPath: wikiHref(ctx.basePath, page.id),
  });
  return { html, headers };
}

export function simplePage(ctx: RenderCtx, title: string, bodyHtml: string | Raw, opts: Partial<ChromeOpts> = {}): string {
  return chrome(ctx, { title, pageId: null, bodyHtml: typeof bodyHtml === 'string' ? bodyHtml : bodyHtml.html, selectedTab: 'special', ...opts });
}

export { raw };
