import { fnv1a, seededRandom } from '../util/hash.ts';
import type { Page, World } from './content.ts';

// deterministic fake revision histories. same seed version + page id => same history,
// so a crawler that diffs the site between visits sees a stable, boring wiki.

export interface Revision {
  rev: number;
  ts: number;
  author: string;
  bytes: number;
  delta: number;
  summary: string;
  minor: boolean;
}

const SUMMARIES = [
  'typo',
  'fix broken link',
  'update after {v} rollout',
  'clarify wording',
  'added note about worker timeouts',
  'reverted edit by anonymous user',
  'sync with {v} config',
  'moved section to [[{p}]]',
  'removed obsolete example',
  'marked as stale, see talk page',
  'copyedit',
  'add category',
  'updated table',
  'link cleanup after migration',
  'formatting',
  '{a} says this is wrong, flagging',
  'archive notice',
  'restored from backup (mirror import)',
  'undo',
  'expand',
  'add example config',
  'rm dead link to old tracker',
  'small fix',
  'wording per review',
];

export function revisionsFor(page: Page, world: World, seedVersion: string): Revision[] {
  const rnd = seededRandom(fnv1a(`${seedVersion}|${page.id}|history`));
  const start = Date.parse(page.created + 'T09:00:00Z');
  const end = Date.parse(page.modified + 'T17:00:00Z');
  const n = Math.max(1, page.revisions);
  const authors = page.authors.length ? page.authors : world.people.map((p) => p.handle);
  const revs: Revision[] = [];
  let bytes = 800 + Math.floor(rnd() * 1500);
  const span = Math.max(1, end - start);
  for (let i = 0; i < n; i++) {
    const frac = n === 1 ? 1 : i / (n - 1);
    // cluster edits early, thin out later — that's what real stale pages look like
    const t = start + Math.floor(span * Math.pow(frac, 1.6)) + Math.floor(rnd() * 3600_000 * 6);
    const delta = i === 0 ? bytes : Math.floor((rnd() - 0.35) * 700);
    bytes = Math.max(120, bytes + (i === 0 ? 0 : delta));
    const author = i === 0 ? (authors[0] as string) : (authors[Math.floor(rnd() * authors.length)] as string);
    const tpl = i === 0 ? 'created page' : (SUMMARIES[Math.floor(rnd() * SUMMARIES.length)] as string);
    const v = world.versions[Math.min(world.versions.length - 1, Math.floor(frac * world.versions.length))]?.version ?? '2.0';
    const summary = tpl.replace('{v}', v).replace('{p}', page.links[Math.floor(rnd() * Math.max(1, page.links.length))] ?? 'Archive').replace('{a}', authors[Math.floor(rnd() * authors.length)] ?? 'someone');
    revs.push({ rev: 1000 + fnv1a(`${page.id}|${i}`) % 90000, ts: Math.min(t, end), author, bytes, delta: i === 0 ? bytes : delta, summary, minor: i !== 0 && rnd() < 0.35 });
  }
  // last revision on some stale pages is the mirror import bot
  if (page.status === 'archived' || page.status === 'stale') {
    const last = revs[revs.length - 1] as Revision;
    revs.push({ rev: last.rev + 7, ts: Date.parse('2021-11-03T04:12:00Z'), author: 'archive-bot', bytes: last.bytes + 41, delta: 41, summary: 'mirror import: add archive notice', minor: true });
  }
  return revs.sort((a, b) => a.ts - b.ts);
}

export function recentChanges(pages: Page[], world: World, seedVersion: string, limit = 50): Array<Revision & { page: string }> {
  const all: Array<Revision & { page: string }> = [];
  for (const p of pages) {
    if (p.kind === 'redirect' || p.kind === 'gone') continue;
    const revs = revisionsFor(p, world, seedVersion);
    for (const r of revs.slice(-3)) all.push({ ...r, page: p.id });
  }
  return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
}
