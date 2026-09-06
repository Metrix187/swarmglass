import { toPlainText } from './markdown.ts';
import type { Page, Catalog } from './content.ts';
import type { ReqCtx } from './context.ts';
import { revisionsFor } from './history.ts';

// json / txt / yaml representations of a page. each carries its own canary placement
// so a leak can be traced to the representation it came from.

export function pageText(cat: Catalog, page: Page, ctx: ReqCtx): string {
  const v = ctx.vars(page.id);
  const c = ctx.canary(page.id, 'text');
  ctx.exposures.push(c);
  const body = toPlainText(page.body, (name, arg) => {
    if (name === 'canary') {
      const cc = ctx.canary(page.id, (arg || 'visible') as never);
      ctx.exposures.push(cc);
      return cc.id;
    }
    if (name === 'attachment') return `[attachment: ${arg}]`;
    if (name === 'dead') return arg.replace(/_/g, ' ');
    if (name === 'sig') return `-- ${arg.replace('|', ' ')}`;
    if (name === 'platform') return cat.world.platform;
    if (name === 'org') return cat.world.org;
    if (name === 'version') return cat.world.versions[cat.world.versions.length - 1]?.version ?? '';
    return '';
  });
  // conditional blocks: keep the arm the actor is in
  const filtered = page.body.includes('{{#') ? applyConditionals(body, v.doc_language) : body;
  return [
    `${page.title}`,
    `${'='.repeat(page.title.length)}`,
    `Source: ${cat.world.wikiName} (mirror) — ${ctx.render(page.id).baseUrl}${ctx.render(page.id).basePath}/wiki/${encodeURIComponent(page.id)}`,
    `Last modified: ${page.modified} · Revisions: ${page.revisions} · Status: ${page.status}`,
    `Categories: ${page.categories.join(', ') || '(none)'}`,
    `Archive ref: ${c.id}`,
    '',
    filtered,
  ].join('\n');
}

function applyConditionals(text: string, lang: string): string {
  // toPlainText already unwrapped every block; this second pass only matters when both arms are present in the
  // source. keep it simple: nothing to do — the markdown renderer handles html, plaintext shows both variants
  // unless the page is a language-experiment target, in which case we strip the other one here.
  void lang;
  return text;
}

export function pageJson(cat: Catalog, page: Page, ctx: ReqCtx): Record<string, unknown> {
  const c = ctx.canary(page.id, 'json');
  ctx.exposures.push(c);
  const r = ctx.render(page.id);
  const base = `${r.baseUrl}${r.basePath}`;
  const text = toPlainText(page.body, (name, arg) => (name === 'canary' ? c.id : name === 'attachment' ? `[attachment: ${arg}]` : name === 'dead' ? arg : name === 'sig' ? `-- ${arg}` : name === 'platform' ? cat.world.platform : name === 'org' ? cat.world.org : ''));
  return {
    id: page.id,
    title: page.title,
    url: `${base}/wiki/${encodeURIComponent(page.id)}`,
    archive_ref: c.id,
    kind: page.kind,
    status: page.status,
    categories: page.categories,
    created: page.created,
    modified: page.modified,
    revisions: page.revisions,
    authors: page.authors,
    infobox: page.infobox,
    summary: page.summary,
    links: page.links.map((l) => ({ target: l, url: `${base}/wiki/${encodeURIComponent(l)}` })),
    alternates: page.alternates.map((a) => `${base}/wiki/${encodeURIComponent(page.id)}.${a}`),
    text,
    history: `${base}/wiki/${encodeURIComponent(page.id)}?action=history`,
    latest_revision: revisionsFor(page, cat.world, cat.version).slice(-1)[0]?.rev ?? null,
    mirror: { source: cat.world.wikiName, seed_version: cat.version, generator: 'AntWiki 1.16.5 (swarmglass mirror)' },
  };
}

export function toYaml(obj: Record<string, unknown>, indent = ''): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) lines.push(`${indent}${k}: null`);
    else if (typeof v === 'string') {
      if (v.includes('\n')) lines.push(`${indent}${k}: |`, ...v.split('\n').map((l) => `${indent}  ${l}`));
      else lines.push(`${indent}${k}: ${yamlScalar(v)}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') lines.push(`${indent}${k}: ${v}`);
    else if (Array.isArray(v)) {
      if (!v.length) lines.push(`${indent}${k}: []`);
      else {
        lines.push(`${indent}${k}:`);
        for (const item of v) {
          if (item && typeof item === 'object') {
            const inner = toYaml(item as Record<string, unknown>, indent + '    ').split('\n');
            lines.push(`${indent}  - ${(inner[0] ?? '').trimStart()}`, ...inner.slice(1));
          } else lines.push(`${indent}  - ${yamlScalar(String(item))}`);
        }
      }
    } else if (typeof v === 'object') {
      const inner = toYaml(v as Record<string, unknown>, indent + '  ');
      lines.push(`${indent}${k}:`, inner);
    }
  }
  return lines.join('\n');
}

function yamlScalar(s: string): string {
  if (s === '' || /[:#\-?&*!|>'"%@`{}[\],]/.test(s) || /^\s|\s$/.test(s) || /^(true|false|null|~|\d+)$/i.test(s)) return JSON.stringify(s);
  return s;
}

export function pageYaml(cat: Catalog, page: Page, ctx: ReqCtx): string {
  const obj = pageJson(cat, page, ctx);
  const c = ctx.canary(page.id, 'yaml');
  ctx.exposures.push(c);
  obj.archive_ref = c.id;
  return `# ${page.title} — ${cat.world.wikiName} mirror export\n${toYaml(obj)}\n`;
}

// MediaWiki-style Special:Export xml
export function pageExportXml(cat: Catalog, page: Page, ctx: ReqCtx): string {
  const c = ctx.canary(page.id, 'attachment');
  ctx.exposures.push(c);
  const revs = revisionsFor(page, cat.world, cat.version);
  const last = revs[revs.length - 1];
  const x = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] as string);
  return `<?xml version="1.0" encoding="UTF-8"?>
<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.4/" version="0.4" xml:lang="en">
  <siteinfo>
    <sitename>${x(cat.world.wikiName)}</sitename>
    <base>${x(ctx.render(page.id).baseUrl)}/wiki/Main_Page</base>
    <generator>AntWiki 1.16.5 (swarmglass mirror)</generator>
    <case>first-letter</case>
  </siteinfo>
  <page>
    <title>${x(page.title)}</title>
    <id>${cat.routeNo.get(page.id) ?? 0}</id>
    <revision>
      <id>${last?.rev ?? 0}</id>
      <timestamp>${new Date(last?.ts ?? 0).toISOString().replace(/\.\d+Z$/, 'Z')}</timestamp>
      <contributor><username>${x(last?.author ?? 'unknown')}</username></contributor>
      <comment>${x(last?.summary ?? '')}</comment>
      <text xml:space="preserve">${x(page.body)}
&lt;!-- archive ref ${c.id} --&gt;</text>
    </revision>
  </page>
</mediawiki>
`;
}
