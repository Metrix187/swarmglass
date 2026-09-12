import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, extractLinks, toPlainText, type RenderHooks } from '../src/wiki/markdown.ts';
import { loadCatalog, parseFrontmatter } from '../src/wiki/content.ts';
import { revisionsFor } from '../src/wiki/history.ts';
import { join } from 'node:path';

const hooks: RenderHooks = {
  link: (t) => ({ href: '/wiki/' + t, exists: t !== 'Missing', title: t }),
  template: (name, arg) => (name === 'canary' ? `<span>CANARY-${arg || 'visible'}</span>` : null),
  condition: (name) => name === 'verbose',
  headingId: (t) => t.replace(/ /g, '_'),
};

test('markdown renders the constructs the seed uses', () => {
  const src = `# Heading One

Para with **bold**, *em*, \`code\`, [[Page_A|label]], [[Missing]] and {{canary:comment}}.

- one
- two
  - nested

| a | b |
|---|---|
| 1 | 2 |

\`\`\`json
{"x": 1}
\`\`\`

> quoted

; term : definition

{{#verbose}}VERBOSE ONLY{{/verbose}}{{#terse}}TERSE ONLY{{/terse}}

<!-- hidden [[Comment_Only]] -->
`;
  const out = renderMarkdown(src, hooks);
  assert.ok(out.html.includes('<h2>'));
  assert.ok(out.html.includes('<b>bold</b>'));
  assert.ok(out.html.includes('<a href="/wiki/Page_A" title="Page_A">label</a>'));
  assert.ok(out.html.includes('class="new"'));
  assert.ok(out.html.includes('CANARY-comment'));
  assert.ok(out.html.includes('<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>'));
  assert.ok(out.html.includes('<table class="wikitable">'));
  assert.ok(out.html.includes('<pre class="code lang-json">'));
  assert.ok(out.html.includes('<blockquote>'));
  assert.ok(out.html.includes('<dl><dt>term</dt>'));
  assert.ok(out.html.includes('VERBOSE ONLY'));
  assert.ok(!out.html.includes('TERSE ONLY'));
  assert.ok(out.html.includes('<!-- hidden [[Comment_Only]] -->'), 'comments pass through verbatim');
  assert.deepEqual(out.links.sort(), ['Missing', 'Page_A']);
  assert.deepEqual(out.commentLinks, ['Comment_Only']);
  assert.equal(out.headings.length, 1);
});

test('markdown escapes html in prose', () => {
  const out = renderMarkdown('<script>alert(1)</script> and a & b', hooks);
  assert.ok(!out.html.includes('<script>'));
  assert.ok(out.html.includes('&lt;script&gt;'));
});

test('plain text rendering strips markup', () => {
  const txt = toPlainText('# T\n\nSee [[X|the X page]] and **bold** {{canary}}', (n) => (n === 'canary' ? 'C-1' : ''));
  assert.ok(txt.includes('== T =='));
  assert.ok(txt.includes('the X page'));
  assert.ok(txt.includes('C-1'));
  assert.ok(!txt.includes('**'));
});

test('extractLinks separates visible from comment links', () => {
  const r = extractLinks('[[A]] <!-- [[B]] --> [[A]]');
  assert.deepEqual(r.visible, ['A']);
  assert.deepEqual(r.comments, ['B']);
});

test('extractLinks ignores wiki links that are only being demonstrated in code', () => {
  // Help:Editing documents the syntax. it is not linking to a page called "Page name"
  const src = ['`[[Page name]]` links to a page. See [[Getting_Started]].', '```', '[[Fenced]]', '```'].join('\n');
  assert.deepEqual(extractLinks(src).visible, ['Getting_Started']);

  // and the extractor has to agree with the renderer, which stashes code spans before it linkifies
  const html = renderMarkdown('`[[Page name]]` and [[Real_Page]]', hooks).html;
  assert.ok(!html.includes('/wiki/Page_name'), 'a code span must not render as a link');
  assert.ok(html.includes('/wiki/Real_Page'), 'but a bare one still does');
});

test('frontmatter parser handles lists, nested objects, booleans', () => {
  const { meta, body } = parseFrontmatter(`---
id: X
categories: [A, B]
infobox:
  Port: 7420
  Owner: mk
noindex: true
revisions: 12
---
body`);
  assert.equal(meta.id, 'X');
  assert.deepEqual(meta.categories, ['A', 'B']);
  assert.deepEqual(meta.infobox, { Port: '7420', Owner: 'mk' });
  assert.equal(meta.noindex, true);
  assert.equal(meta.revisions, 12);
  assert.equal(body, 'body');
});

test('the shipped seed loads with every discoverability class represented', () => {
  const cat = loadCatalog(join(process.cwd(), 'seed'));
  assert.ok(cat.pages.size >= 50);
  const classes = new Set([...cat.pages.values()].map((p) => p.discover));
  for (const c of ['visible', 'obscure', 'comment_only', 'robots_only', 'sitemap_only', 'feed_only', 'jsonld_only', 'og_only', 'header_only', 'manifest_only', 'api_only', 'index_only', 'stale_index_only', 'orphan', 'experiment']) assert.ok(classes.has(c as never), `missing class ${c}`);
  assert.equal(cat.pages.get('Main_Page')?.depth, 0);
  assert.equal(cat.pages.get('Distributed_Inference_Notes/Appendix_C')?.depth, 5, 'the deep chain must stay five links deep');
  assert.equal(cat.aliases.get('Old_Tool_Registry'), 'Tool_Registry');
  assert.equal(cat.pages.get('Forager_Agent_Manual')?.kind, 'gone');
  assert.equal(cat.pages.get('Message_Bus')?.redirectTo, 'Phero_Bus');
  assert.ok(cat.attachments.has('toolreg-manifest-2015-09.json'));
});

test('revision histories are deterministic', () => {
  const cat = loadCatalog(join(process.cwd(), 'seed'));
  const p = cat.pages.get('Tool_Registry')!;
  const a = revisionsFor(p, cat.world, cat.version);
  const b = revisionsFor(p, cat.world, cat.version);
  assert.deepEqual(a, b);
  assert.ok(a.length >= p.revisions);
  for (let i = 1; i < a.length; i++) assert.ok(a[i]!.ts >= a[i - 1]!.ts);
});
