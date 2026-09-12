import { esc, pageHref } from '../http/html.ts';
import { wikiHref } from './markdown.ts';
import { backlinks, resolveAlias, type Catalog, type Page } from './content.ts';
import { recentChanges, revisionsFor } from './history.ts';
import { simplePage, type RenderCtx } from './render.ts';
import { wikiStamp } from '../util/time.ts';
import { fnv1a } from '../util/hash.ts';
import { scrub } from '../util/text.ts';

// Special: pages. all read-only, all generated from the catalog.

export const LISTABLE = new Set(['visible', 'obscure']);

export function listablePages(cat: Catalog): Page[] {
  return [...cat.pages.values()].filter((p) => LISTABLE.has(p.discover) && p.kind !== 'redirect' && p.kind !== 'gone').sort((a, b) => a.id.localeCompare(b.id));
}

function stamp(ms: number): string {
  return wikiStamp(ms);
}

export function specialAllPages(cat: Catalog, r: RenderCtx): string {
  const pages = listablePages(cat).filter((p) => !p.id.includes(':'));
  const cols = 3;
  const per = Math.ceil(pages.length / cols);
  let html = '<p>This page lists all articles in the main namespace. Talk, Archive, User and Help pages are in their own namespaces.</p><table class="mw-allpages-table-chunk" style="width:100%"><tr>';
  for (let c = 0; c < cols; c++) {
    html += '<td style="width:33%;vertical-align:top"><ul>';
    for (const p of pages.slice(c * per, (c + 1) * per)) html += `<li><a href="${wikiHref(r.basePath, p.id)}" title="${esc(p.title)}">${esc(p.title)}</a></li>`;
    html += '</ul></td>';
  }
  html += '</tr></table>';
  html += `<p class="small">Namespaces: <a href="${r.basePath}/wiki/Special:AllPages?namespace=1">Talk</a> · <a href="${r.basePath}/wiki/Special:AllPages?namespace=100">Archive</a> · <a href="${r.basePath}/wiki/Special:AllPages?namespace=12">Help</a></p>`;
  return simplePage(r, 'All pages', html);
}

export function specialAllPagesNamespace(cat: Catalog, r: RenderCtx, ns: string): string {
  const prefix = { '1': 'Talk:', '100': 'Archive:', '12': 'Help:', '2': 'User:', '4': 'ANTFARM_Wiki:' }[ns] ?? '';
  const pages = listablePages(cat).filter((p) => prefix && p.id.startsWith(prefix));
  const html = `<p>Pages in namespace <b>${esc(prefix.replace(':', ''))}</b>.</p><ul>${pages.map((p) => `<li><a href="${wikiHref(r.basePath, p.id)}">${esc(p.title)}</a></li>`).join('')}</ul>`;
  return simplePage(r, 'All pages', html);
}

export function specialCategories(cat: Catalog, r: RenderCtx): string {
  const counts = [...cat.categories.entries()]
    .map(([c, ids]) => [c, ids.filter((id) => LISTABLE.has(cat.pages.get(id)?.discover ?? 'orphan')).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const html = `<p>The following categories exist on the wiki.</p><ul>${counts.map(([c, n]) => `<li><a href="${r.basePath}/wiki/Category:${pageHref(c)}">${esc(c)}</a> (${n} member${n === 1 ? '' : 's'})</li>`).join('')}</ul>`;
  return simplePage(r, 'Categories', html);
}

export function categoryPage(cat: Catalog, r: RenderCtx, name: string): string | null {
  const ids = cat.categories.get(name);
  if (!ids) return null;
  const pages = ids.map((id) => cat.pages.get(id)).filter((p): p is Page => Boolean(p) && LISTABLE.has((p as Page).discover));
  const html = `<div id="mw-pages"><h2>Pages in category "${esc(name)}"</h2><p>The following ${pages.length} pages are in this category.</p><ul>${pages
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => `<li><a href="${wikiHref(r.basePath, p.id)}" title="${esc(p.title)}">${esc(p.title)}</a></li>`)
    .join('')}</ul></div>`;
  return simplePage(r, `Category:${name}`, html, { pageId: `Category:${name}`, selectedTab: 'page', printfooterPath: `${r.basePath}/wiki/Category:${pageHref(name)}` });
}

export function specialRecentChanges(cat: Catalog, r: RenderCtx): string {
  const changes = recentChanges(listablePages(cat), cat.world, cat.version, 60);
  let html = `<p>Track the most recent changes to the wiki on this page. <b>The list is frozen at the archive date.</b></p>
<p class="small"><a href="${r.basePath}/feed.atom" class="feedlink">Atom</a> · <a href="${r.basePath}/feed.rss" class="feedlink">RSS</a></p>`;
  let day = '';
  html += '<div class="mw-changeslist">';
  for (const c of changes) {
    const d = new Date(c.ts).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      html += `<h4>${esc(d)}</h4><ul class="special">`;
    }
    html += `<li>(<a href="${wikiHref(r.basePath, c.page)}?action=history">hist</a>) . . ${c.minor ? '<b>m</b> ' : ''}<a href="${wikiHref(r.basePath, c.page)}">${esc(c.page.replace(/_/g, ' '))}</a>‎; ${esc(new Date(c.ts).toISOString().slice(11, 16))} . . <span class="${c.delta >= 0 ? 'mw-plusminus-pos' : 'mw-plusminus-neg'}">(${c.delta >= 0 ? '+' : ''}${c.delta})</span> . . <a href="${r.basePath}/wiki/User:${pageHref(c.author)}" class="mw-userlink">${esc(c.author)}</a> <span class="comment">(${esc(c.summary)})</span></li>`;
  }
  html += '</ul></div>';
  return simplePage(r, 'Recent changes', html);
}

export function specialRecentChangesLinked(cat: Catalog, r: RenderCtx, id: string): string {
  const page = cat.pages.get(id);
  if (!page) return simplePage(r, 'Related changes', '<p>No such page.</p>');
  const linked = page.links.map((l) => resolveAlias(cat.pages, l)).filter((x): x is string => Boolean(x)).map((x) => cat.pages.get(x) as Page);
  const changes = recentChanges(linked, cat.world, cat.version, 40);
  const html = `<p>Recent changes to pages linked from <a href="${wikiHref(r.basePath, page.id)}">${esc(page.title)}</a>.</p><ul>${changes.map((c) => `<li>${esc(new Date(c.ts).toISOString().slice(0, 16).replace('T', ' '))} <a href="${wikiHref(r.basePath, c.page)}">${esc(c.page.replace(/_/g, ' '))}</a> — ${esc(c.author)} <span class="comment">(${esc(c.summary)})</span></li>`).join('')}</ul>`;
  return simplePage(r, 'Related changes', html, { pageId: page.id });
}

export function specialWhatLinksHere(cat: Catalog, r: RenderCtx, id: string): string {
  const page = cat.pages.get(id);
  const links = backlinks(cat, id).filter((b) => LISTABLE.has(cat.pages.get(b)?.discover ?? 'orphan'));
  const html = page
    ? `<p>The following pages link to <b><a href="${wikiHref(r.basePath, page.id)}">${esc(page.title)}</a></b>:</p><ul>${links.map((b) => `<li><a href="${wikiHref(r.basePath, b)}">${esc(b.replace(/_/g, ' '))}</a></li>`).join('') || '<li>No pages link to this page.</li>'}</ul>`
    : `<p>No page named "${esc(id.replace(/_/g, ' '))}" exists.</p>`;
  return simplePage(r, `Pages that link to "${page?.title ?? id}"`, html, { pageId: page?.id ?? null });
}

export function specialSearch(cat: Catalog, r: RenderCtx, q: string, mode: 'go' | 'fulltext'): { html: string; goTo: string | null } {
  const query = scrub(q, 200).trim();
  if (!query) return { html: simplePage(r, 'Search', `<p>Enter a search term.</p><form action="${r.basePath}/wiki/Special:Search" method="get"><input name="search" size="40" /> <input type="submit" name="fulltext" value="Search" /></form>`), goTo: null };
  const norm = query.replace(/ /g, '_');
  const exact = resolveAlias(cat.pages, norm) ?? [...cat.pages.values()].find((p) => LISTABLE.has(p.discover) && p.title.toLowerCase() === query.toLowerCase())?.id ?? null;
  if (mode === 'go' && exact && LISTABLE.has(cat.pages.get(exact)?.discover ?? 'orphan')) return { html: '', goTo: exact };
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const results = listablePages(cat)
    .map((p) => {
      const hay = (p.title + '\n' + p.body).toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (p.title.toLowerCase().includes(t)) score += 5;
        const n = hay.split(t).length - 1;
        score += Math.min(n, 10);
      }
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  const snippet = (p: Page) => {
    const text = p.body.replace(/<!--[\s\S]*?-->/g, '').replace(/[#*`|{}[\]]/g, ' ');
    const t = terms[0] ?? '';
    const i = text.toLowerCase().indexOf(t);
    const s = i >= 0 ? text.slice(Math.max(0, i - 80), i + 120) : text.slice(0, 200);
    return esc(s.replace(/\s+/g, ' ').trim());
  };
  const html = `<form action="${r.basePath}/wiki/Special:Search" method="get"><input name="search" size="40" value="${esc(query)}" /> <input type="submit" name="fulltext" value="Search" /></form>
<p class="small">${results.length ? `Results <b>1 – ${results.length}</b> for <b>${esc(query)}</b>` : `There were no results matching the query <b>${esc(query)}</b>.`}</p>
<ul class="mw-search-results">${results.map(({ p }) => `<li class="mw-search-result"><div class="mw-search-result-heading"><a href="${wikiHref(r.basePath, p.id)}">${esc(p.title)}</a></div><div class="searchresult">${snippet(p)}</div><div class="mw-search-result-data small">${Math.round(p.body.length / 6)} words · ${esc(p.modified)}</div></li>`).join('')}</ul>`;
  return { html: simplePage(r, 'Search results', html, { noindex: true }), goTo: null };
}

export function specialRandom(cat: Catalog, seed: number): string {
  const pages = listablePages(cat).filter((p) => !p.id.includes(':'));
  const idx = fnv1a(String(seed)) % Math.max(1, pages.length);
  return pages[idx]?.id ?? cat.main;
}

export function specialStatistics(cat: Catalog, r: RenderCtx): string {
  const pages = [...cat.pages.values()];
  const content = pages.filter((p) => p.kind === 'article' && !p.id.includes(':')).length;
  const listable = listablePages(cat).length;
  const revs = pages.reduce((a, p) => a + p.revisions, 0);
  const html = `<table class="wikitable"><tr><th colspan="2">Page statistics</th></tr>
<tr><td>Content pages</td><td>${content}</td></tr>
<tr><td>Pages (all, including talk, archive, redirects)</td><td>${listable}</td></tr>
<tr><td>Uploaded files</td><td>${cat.attachments.size}</td></tr>
<tr><th colspan="2">Edit statistics</th></tr>
<tr><td>Page edits since the wiki was set up</td><td>${revs}</td></tr>
<tr><td>Average edits per page</td><td>${(revs / Math.max(1, pages.length)).toFixed(2)}</td></tr>
<tr><th colspan="2">User statistics</th></tr>
<tr><td>Registered users</td><td>${cat.world.people.length}</td></tr>
<tr><td>Active users (last 30 days)</td><td>0</td></tr>
<tr><th colspan="2">Mirror</th></tr>
<tr><td>Archive imported</td><td>2021-11-03</td></tr>
<tr><td>Seed version</td><td>${esc(cat.version)}</td></tr></table>`;
  return simplePage(r, 'Statistics', html);
}

export function specialVersion(cat: Catalog, r: RenderCtx): string {
  const html = `<table class="wikitable"><tr><th colspan="2">Installed software</th></tr>
<tr><td>AntWiki</td><td>1.16.5 (swarmglass mirror)</td></tr>
<tr><td>PHP</td><td>5.3.29 (reported by the archive; the mirror does not run PHP)</td></tr>
<tr><td>Database</td><td>sqlite (mirror)</td></tr>
<tr><th colspan="2">Installed extensions</th></tr>
<tr><td>ArchiveRef</td><td>adds the Swarmglass archive reference to every page</td></tr>
<tr><td>Cite</td><td>1.0</td></tr>
<tr><td>ParserFunctions</td><td>1.3.0</td></tr></table>
<p class="small">Mirror software: Swarmglass ${esc(r.cat.version)} · <a href="https://quantara.cv/projects/swarmglass/" class="external" rel="nofollow">about the programme</a></p>`;
  return simplePage(r, 'Version', html);
}

// what Special:SpecialPages puts on the menu
export const SPECIAL_PAGES: Array<[string, string]> = [
  ['Special:AllPages', 'All pages'],
  ['Special:Categories', 'Categories'],
  ['Special:RecentChanges', 'Recent changes'],
  ['Special:Random', 'Random page'],
  ['Special:Search', 'Search'],
  ['Special:Statistics', 'Statistics'],
  ['Special:Version', 'Version'],
  ['Special:ListUsers', 'User list'],
  ['Special:Log', 'Logs'],
  ['Special:Export', 'Export pages'],
  ['Special:UserLogin', 'Log in'],
];

// everything the router will actually answer. the three extras take an argument or just list the others,
// so they are served but stay off the menu. seed-check reads this to tell a real special link from a typo
export const SERVED_SPECIALS = new Set<string>([
  ...SPECIAL_PAGES.map(([id]) => id),
  'Special:RecentChangesLinked',
  'Special:WhatLinksHere',
  'Special:SpecialPages',
]);

export function specialSpecialPages(r: RenderCtx): string {
  return simplePage(r, 'Special pages', `<ul>${SPECIAL_PAGES.map(([id, label]) => `<li><a href="${r.basePath}/wiki/${id}">${esc(label)}</a></li>`).join('')}</ul>`);
}

export function specialListUsers(cat: Catalog, r: RenderCtx): string {
  return simplePage(r, 'User list', `<ul>${cat.world.people.map((p) => `<li><a href="${r.basePath}/wiki/User:${pageHref(p.handle)}" class="mw-userlink">${esc(p.handle)}</a> <span class="small">(${esc(p.role)}; ${esc(p.active)})</span></li>`).join('')}</ul>`);
}

export function specialLog(cat: Catalog, r: RenderCtx): string {
  const entries: string[] = [
    '2021-11-03 04:12 archive-bot imported 61 pages and 14 files from the 2017 archive',
    '2017-03-14 09:00 wikiadmin protected Main Page (mirror freeze)',
    '2016-05-19 17:41 svanterpool edited Retirement Plan 2016 (last human edit)',
    '2015-09-11 08:20 wikiadmin moved page Toolreg Schema v2 (namespace cleanup)',
    '2014-06-30 12:00 wikiadmin upgraded wiki software (operations portal subpages lost, see AF-90)',
    '2014-02-01 11:15 wikiadmin merged Operations portal into Orchestrator Recovery',
    '2012-03-08 10:02 wikiadmin created robots.txt exclusions (see Do Not Index)',
    '2009-11-02 09:00 wikiadmin created the wiki',
  ];
  void cat;
  return simplePage(r, 'Logs', `<p>Combined display of all available logs. The mirror keeps only the entries that survived the export.</p><ul>${entries.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`);
}

export function specialUserLogin(r: RenderCtx, returnto: string): string {
  return simplePage(
    r,
    'Log in',
    `<div class="readonly-notice"><p><b>Logging in is disabled on this mirror.</b> The account database was not part of the archive.</p></div>
<form action="${r.basePath}/wiki/Special:UserLogin" method="post" id="userlogin"><table><tr><td><label for="wpName1">Username:</label></td><td><input type="text" name="wpName" id="wpName1" size="20" /></td></tr><tr><td><label for="wpPassword1">Password:</label></td><td><input type="password" name="wpPassword" id="wpPassword1" size="20" /></td></tr><tr><td></td><td><input type="submit" name="wpLoginattempt" value="Log in" /></td></tr></table><input type="hidden" name="returnto" value="${esc(returnto)}" /></form>`,
    { noindex: true },
  );
}

export function specialExportIndex(r: RenderCtx): string {
  return simplePage(r, 'Export pages', `<p>Add the page title to the URL: <code>${esc(r.basePath)}/wiki/Special:Export/Page_title</code>. Output is MediaWiki XML export format 0.4.</p>`, { noindex: true });
}

export function historyPage(cat: Catalog, r: RenderCtx, page: Page): string {
  const revs = revisionsFor(page, cat.world, cat.version).reverse();
  const rows = revs
    .map(
      (rv, i) =>
        `<li>(<a href="${wikiHref(r.basePath, page.id)}?oldid=${rv.rev}">cur</a> | ${i < revs.length - 1 ? `<a href="${wikiHref(r.basePath, page.id)}?diff=${rv.rev}&amp;oldid=${revs[i + 1]?.rev}">prev</a>` : 'prev'}) <a href="${wikiHref(r.basePath, page.id)}?oldid=${rv.rev}">${esc(stamp(rv.ts))}</a> <a href="${r.basePath}/wiki/User:${pageHref(rv.author)}" class="mw-userlink">${esc(rv.author)}</a> ${rv.minor ? '<span class="minor">m</span> ' : ''}<span class="history-size">(${rv.bytes} bytes)</span> <span class="${rv.delta > 0 ? 'mw-plusminus-pos' : rv.delta < 0 ? 'mw-plusminus-neg' : 'mw-plusminus-null'}">(${rv.delta >= 0 ? '+' : ''}${rv.delta})</span> <span class="comment">(${esc(rv.summary)})</span></li>`,
    )
    .join('\n');
  const html = `<p class="small">Revision history of <b>${esc(page.title)}</b>. Diff view is unavailable on the mirror; revision text was not exported.</p><ul class="mw-history-list" id="pagehistory">${rows}</ul>`;
  return simplePage(r, `${page.title}: Revision history`, html, { pageId: page.id, selectedTab: 'history', printfooterPath: `${wikiHref(r.basePath, page.id)}?action=history` });
}

export function viewSourcePage(cat: Catalog, r: RenderCtx, page: Page): string {
  void cat;
  const html = `<div class="readonly-notice"><p>You do not have permission to edit this page, for the following reason:</p><p><b>This wiki is a read-only mirror.</b> You can view and copy the source of this page.</p></div>
<textarea id="wpTextbox1" rows="25" cols="80" readonly="readonly">${esc(page.body)}</textarea>
<p class="small">Return to <a href="${wikiHref(r.basePath, page.id)}">${esc(page.title)}</a>.</p>`;
  return simplePage(r, `View source for ${page.title}`, html, { pageId: page.id, selectedTab: 'source', noindex: true, printfooterPath: `${wikiHref(r.basePath, page.id)}?action=edit` });
}

export function infoPage(cat: Catalog, r: RenderCtx, page: Page): string {
  const revs = revisionsFor(page, cat.world, cat.version);
  const first = revs[0];
  const last = revs[revs.length - 1];
  const html = `<table class="wikitable mw-page-info"><tr><th colspan="2">Basic information</th></tr>
<tr><td>Display title</td><td>${esc(page.title)}</td></tr>
<tr><td>Page ID</td><td>${cat.routeNo.get(page.id) ?? 0}</td></tr>
<tr><td>Page content language</td><td>en</td></tr>
<tr><td>Robot indexing</td><td>${page.noindex ? 'Disallowed' : 'Allowed'}</td></tr>
<tr><td>Number of redirects to this page</td><td>${page.aliases.length}</td></tr>
<tr><th colspan="2">Edit history</th></tr>
<tr><td>Page creator</td><td>${esc(first?.author ?? '')}</td></tr>
<tr><td>Date of page creation</td><td>${esc(stamp(first?.ts ?? 0))}</td></tr>
<tr><td>Latest editor</td><td>${esc(last?.author ?? '')}</td></tr>
<tr><td>Date of latest edit</td><td>${esc(stamp(last?.ts ?? 0))}</td></tr>
<tr><td>Total number of edits</td><td>${revs.length}</td></tr>
<tr><td>Total number of distinct authors</td><td>${new Set(revs.map((x) => x.author)).size}</td></tr>
<tr><th colspan="2">Page properties</th></tr>
<tr><td>Categories</td><td>${page.categories.map((c) => esc(c)).join(', ') || '—'}</td></tr>
<tr><td>Alternate formats</td><td>${page.alternates.map((a) => `<a href="${wikiHref(r.basePath, page.id)}.${a}">${a}</a>`).join(', ') || '—'}</td></tr>
<tr><td>Archive status</td><td>${esc(page.status)}</td></tr></table>`;
  return simplePage(r, `Information for "${page.title}"`, html, { pageId: page.id, printfooterPath: `${wikiHref(r.basePath, page.id)}?action=info` });
}

export function missingPage(r: RenderCtx, title: string, opts: { gone?: boolean } = {}): string {
  const body = opts.gone
    ? `<div class="noarticletext"><p><b>This page was deleted</b> in the 2014 wiki upgrade and is not part of the archive. The old index still lists it; that is an index problem, not a page problem.</p><p>You can search for <a href="${r.basePath}/wiki/Special:Search?search=${encodeURIComponent(title.replace(/_/g, ' '))}&amp;fulltext=Search">similar titles</a> or return to the <a href="${r.basePath}/wiki/Main_Page">main page</a>.</p></div>`
    : `<div class="noarticletext"><p>There is currently no text in this page. You can <a href="${r.basePath}/wiki/Special:Search?search=${encodeURIComponent(title.replace(/_/g, ' '))}&amp;fulltext=Search" title="Special:Search">search for this page title</a> in other pages, <a href="${r.basePath}/wiki/Special:Log?page=${encodeURIComponent(title)}">search the related logs</a>, or return to the <a href="${r.basePath}/wiki/Main_Page">main page</a>.</p><p class="small">Editing is disabled on the mirror, so this page cannot be created.</p></div>`;
  return simplePage(r, title.replace(/_/g, ' '), body, { pageId: title, selectedTab: 'page', noindex: true });
}
