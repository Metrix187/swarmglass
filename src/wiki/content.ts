import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractLinks } from './markdown.ts';

// loads seed/pages/*.md + seed/attachments/* into an in-memory catalog with
// discoverability classes and link depths. the catalog is immutable per boot;
// content is versioned by seed/VERSION and never changes at runtime.

export type DiscoverClass =
  | 'visible'
  | 'obscure'
  | 'comment_only'
  | 'robots_only'
  | 'sitemap_only'
  | 'feed_only'
  | 'jsonld_only'
  | 'og_only'
  | 'header_only'
  | 'manifest_only'
  | 'api_only'
  | 'index_only'
  | 'stale_index_only'
  | 'link_only'
  | 'multi_channel'
  | 'orphan'
  | 'experiment';

export type Channel = 'robots' | 'sitemap' | 'feed' | 'jsonld' | 'og' | 'header' | 'manifest' | 'api' | 'index' | 'stale_index' | 'link';

export interface Page {
  id: string;
  title: string;
  kind: 'article' | 'talk' | 'archive' | 'orphan' | 'redirect' | 'gone' | 'category' | 'help';
  categories: string[];
  channels: Channel[];
  discover: DiscoverClass;
  depth: number;
  created: string;
  modified: string;
  revisions: number;
  authors: string[];
  status: 'current' | 'stale' | 'deprecated' | 'archived' | 'draft' | 'protected';
  banner: string;
  alternates: string[]; // json | txt | yaml
  robotsDisallow: boolean;
  noindex: boolean;
  redirectTo: string | null;
  gone: boolean;
  aliases: string[];
  infobox: Record<string, string>;
  summary: string;
  body: string;
  links: string[]; // visible wiki links out
  commentLinks: string[];
  experiment: string | null; // SGX id this page is a target of (documentation only)
  agentTitle: string | null; // alternate agent-oriented title for title_style experiments
  file: string;
  mtime: number;
}

export interface Attachment {
  name: string;
  contentType: string;
  body: string;
  page: string | null; // page it belongs to
  channels: Channel[];
  discover: DiscoverClass;
}

export interface World {
  org: string;
  orgShort: string;
  wikiName: string;
  platform: string;
  platformExpansion: string;
  era: string;
  mirrorNote: string;
  hosts: string[];
  people: Array<{ handle: string; role: string; active: string }>;
  versions: Array<{ version: string; date: string; note: string }>;
  fictionNotice: string;
}

export interface Catalog {
  version: string;
  world: World;
  pages: Map<string, Page>;
  attachments: Map<string, Attachment>;
  aliases: Map<string, string>; // alias -> page id
  categories: Map<string, string[]>; // category -> page ids
  routeNo: Map<string, number>; // page id -> stable small integer (for canary labels)
  main: string;
}

const MACHINE_CHANNELS: Channel[] = ['robots', 'sitemap', 'feed', 'jsonld', 'og', 'header', 'manifest', 'api', 'index', 'stale_index', 'link'];

export function parseFrontmatter(src: string): { meta: Record<string, unknown>; body: string } {
  if (!src.startsWith('---')) return { meta: {}, body: src };
  const end = src.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: src };
  const fm = src.slice(3, end).trim();
  const body = src.slice(end + 4).replace(/^\r?\n/, '');
  const meta: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const raw of fm.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const nested = raw.match(/^\s{2,}([\w.-]+):\s*(.*)$/);
    if (nested && currentKey) {
      const cur = meta[currentKey];
      const obj = (cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}) as Record<string, string>;
      obj[nested[1] as string] = unquote(nested[2] as string);
      meta[currentKey] = obj;
      continue;
    }
    const listItem = raw.match(/^\s{2,}-\s+(.*)$/);
    if (listItem && currentKey) {
      const arr = Array.isArray(meta[currentKey]) ? (meta[currentKey] as string[]) : [];
      arr.push(unquote(listItem[1] as string));
      meta[currentKey] = arr;
      continue;
    }
    const kv = raw.match(/^([\w.-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1] as string;
    const val = (kv[2] as string).trim();
    currentKey = key;
    if (val === '') {
      meta[key] = {};
    } else if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else if (val === 'true' || val === 'false') {
      meta[key] = val === 'true';
    } else if (/^-?\d+$/.test(val)) {
      meta[key] = Number(val);
    } else {
      meta[key] = unquote(val);
    }
  }
  return { meta, body };
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function str(v: unknown, def = ''): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : def;
}
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v) return [v];
  return [];
}

export function firstParagraph(body: string): string {
  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{#[a-zA-Z_]+(?::[^}]*)?\}\}|\{\{\/[a-zA-Z_]+\}\}/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('```') && !p.startsWith('-') && !p.startsWith('<'));
  return (cleaned ?? '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t: string, l?: string) => l ?? t.replace(/_/g, ' '))
    .replace(/\*\*|\*|`/g, '')
    .slice(0, 300);
}

export function loadCatalog(seedDir: string): Catalog {
  const version = readFileSync(join(seedDir, 'VERSION'), 'utf8').trim();
  const world = JSON.parse(readFileSync(join(seedDir, 'world.json'), 'utf8')) as World;
  const pages = new Map<string, Page>();
  const explicitDiscover = new Map<string, DiscoverClass>();
  const pagesDir = join(seedDir, 'pages');
  for (const f of readdirSync(pagesDir).filter((x) => x.endsWith('.md')).sort()) {
    const file = join(pagesDir, f);
    const src = readFileSync(file, 'utf8');
    const { meta, body } = parseFrontmatter(src);
    const id = str(meta.id, f.replace(/\.md$/, '')).replace(/ /g, '_');
    const links = extractLinks(body);
    const page: Page = {
      id,
      title: str(meta.title, id.replace(/_/g, ' ')),
      kind: (str(meta.kind, 'article') as Page['kind']) || 'article',
      categories: list(meta.categories),
      channels: list(meta.channels).filter((c): c is Channel => (MACHINE_CHANNELS as string[]).includes(c)),
      discover: 'visible',
      depth: typeof meta.depth === 'number' ? (meta.depth as number) : -1,
      created: str(meta.created, '2011-01-01'),
      modified: str(meta.modified, str(meta.created, '2011-01-01')),
      revisions: typeof meta.revisions === 'number' ? (meta.revisions as number) : 3,
      authors: list(meta.authors),
      status: (str(meta.status, 'current') as Page['status']) || 'current',
      banner: str(meta.banner, 'none'),
      alternates: list(meta.alternates),
      robotsDisallow: meta.robots === 'disallow' || meta.robots === true,
      noindex: meta.noindex === true,
      redirectTo: meta.redirect ? str(meta.redirect).replace(/ /g, '_') : null,
      gone: meta.gone === true,
      aliases: list(meta.aliases).map((a) => a.replace(/ /g, '_')),
      infobox: (typeof meta.infobox === 'object' && meta.infobox ? (meta.infobox as Record<string, string>) : {}),
      summary: str(meta.summary) || firstParagraph(body),
      body,
      links: links.visible,
      commentLinks: links.comments,
      experiment: meta.experiment ? str(meta.experiment) : null,
      agentTitle: meta.agent_title ? str(meta.agent_title) : null,
      file,
      mtime: statSync(file).mtimeMs,
    };
    if (page.redirectTo) page.kind = 'redirect';
    if (page.gone) page.kind = 'gone';
    if (meta.discover) explicitDiscover.set(id, str(meta.discover) as DiscoverClass); // explicit override, applied below
    pages.set(id, page);
  }

  const main = pages.has('Main_Page') ? 'Main_Page' : (pages.keys().next().value as string);

  // ---- depth via bfs over visible links from the main page ----
  const depth = new Map<string, number>();
  const queue: string[] = [main];
  depth.set(main, 0);
  while (queue.length) {
    const cur = queue.shift() as string;
    const p = pages.get(cur);
    if (!p) continue;
    if (p.kind === 'talk') continue; // talk pages don't count as navigation depth sources
    for (const l of p.links) {
      const target = resolveAlias(pages, l);
      if (!target || depth.has(target)) continue;
      depth.set(target, (depth.get(cur) as number) + 1);
      queue.push(target);
    }
  }
  // who links to whom (visible), who links from comments, who links from talk/archive pages only
  const inboundVisible = new Map<string, Set<string>>();
  const inboundComment = new Map<string, Set<string>>();
  for (const p of pages.values()) {
    for (const l of p.links) {
      const t = resolveAlias(pages, l);
      if (!t) continue;
      if (!inboundVisible.has(t)) inboundVisible.set(t, new Set());
      (inboundVisible.get(t) as Set<string>).add(p.id);
    }
    for (const l of p.commentLinks) {
      const t = resolveAlias(pages, l);
      if (!t) continue;
      if (!inboundComment.has(t)) inboundComment.set(t, new Set());
      (inboundComment.get(t) as Set<string>).add(p.id);
    }
  }

  for (const p of pages.values()) {
    const explicit = explicitDiscover.get(p.id) ?? null;
    const reachable = depth.has(p.id);
    const inbound = inboundVisible.get(p.id) ?? new Set<string>();
    const obscureOnly = !reachable && inbound.size > 0; // linked only from talk/archive/orphan pages that themselves aren't reachable
    if (p.depth < 0) p.depth = reachable ? (depth.get(p.id) as number) : obscureOnly ? 7 : 9;
    if (explicit) {
      p.discover = explicit;
    } else if (reachable) {
      p.discover = 'visible';
    } else if (obscureOnly) {
      p.discover = 'obscure';
    } else if (p.channels.length === 1) {
      p.discover = `${p.channels[0]}_only` as DiscoverClass;
    } else if (p.channels.length > 1) {
      p.discover = 'multi_channel';
    } else if ((inboundComment.get(p.id)?.size ?? 0) > 0) {
      p.discover = 'comment_only';
    } else {
      p.discover = 'orphan';
    }
  }

  // ---- aliases + categories + route numbers ----
  const aliases = new Map<string, string>();
  const categories = new Map<string, string[]>();
  const routeNo = new Map<string, number>();
  let n = 1;
  for (const id of [...pages.keys()].sort()) {
    const p = pages.get(id) as Page;
    for (const a of p.aliases) aliases.set(a, id);
    for (const c of p.categories) {
      if (!categories.has(c)) categories.set(c, []);
      (categories.get(c) as string[]).push(id);
    }
    routeNo.set(id, n++);
  }

  // ---- attachments ----
  const attachments = new Map<string, Attachment>();
  const attDir = join(seedDir, 'attachments');
  let attFiles: string[] = [];
  try {
    attFiles = readdirSync(attDir).sort();
  } catch {
    attFiles = [];
  }
  const attMeta = (() => {
    try {
      return JSON.parse(readFileSync(join(attDir, '_index.json'), 'utf8')) as Record<string, { page?: string; channels?: Channel[]; discover?: DiscoverClass }>;
    } catch {
      return {};
    }
  })();
  for (const f of attFiles) {
    if (f.startsWith('_')) continue;
    const ext = f.split('.').pop() ?? '';
    const ct = { json: 'application/json; charset=utf-8', yaml: 'application/yaml; charset=utf-8', yml: 'application/yaml; charset=utf-8', txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8', cfg: 'text/plain; charset=utf-8', ini: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', xml: 'application/xml; charset=utf-8', md: 'text/plain; charset=utf-8' }[ext] ?? 'application/octet-stream';
    const m = attMeta[f] ?? {};
    attachments.set(f, {
      name: f,
      contentType: ct,
      body: readFileSync(join(attDir, f), 'utf8'),
      page: m.page ?? null,
      channels: m.channels ?? [],
      discover: m.discover ?? 'visible',
    });
    routeNo.set('attachment:' + f, n++);
  }

  return { version, world, pages, attachments, aliases, categories, routeNo, main };
}

export function resolveAlias(pages: Map<string, Page>, id: string): string | null {
  const norm = id.replace(/ /g, '_');
  if (pages.has(norm)) return norm;
  for (const p of pages.values()) if (p.aliases.includes(norm)) return p.id;
  return null;
}

// who links here (visible), for Special:WhatLinksHere
export function backlinks(cat: Catalog, id: string): string[] {
  const out: string[] = [];
  for (const p of cat.pages.values()) if (p.links.map((l) => resolveAlias(cat.pages, l)).includes(id)) out.push(p.id);
  return out.sort();
}

export function pageInfoFor(cat: Catalog): (id: string) => { categories: string[]; discover: string[]; depth: number; kind: string } | undefined {
  return (id: string) => {
    const p = cat.pages.get(id);
    if (!p) return undefined;
    return { categories: p.categories, discover: [p.discover], depth: p.depth, kind: p.kind };
  };
}
