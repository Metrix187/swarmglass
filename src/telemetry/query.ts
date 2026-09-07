// query strings the wiki hands out itself: revision history, diffs, edit/info views, the search form.
// a crawler following those isn't "using query parameters", it's following links, and it isn't
// revisiting anything either, every ?oldid= is a different url. keep this list honest: only keys the
// mirror actually emits. anything else is the visitor's own idea, and that's the interesting part.
export const FURNITURE_KEYS: ReadonlySet<string> = new Set(['action', 'oldid', 'diff', 'section', 'printable', 'redirect', 'returnto', 'namespace', 'page', 'search', 'q', 'fulltext']);

export type Query = Record<string, string>;

export function parseQuery(json: string | null | undefined): Query | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Query = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = String(v ?? '');
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

// true when every key is something the site itself links to
export function isFurniture(q: Query): boolean {
  const keys = Object.keys(q);
  return keys.length > 0 && keys.every((k) => FURNITURE_KEYS.has(k));
}

// stable form for "is this the same url": sorted keys, values capped so one huge param can't bloat ids
export function canonicalQuery(q: Query): string {
  return Object.keys(q)
    .sort()
    .map((k) => `${k}=${(q[k] ?? '').slice(0, 64)}`)
    .join('&');
}

// what a person wants to read next to the path: original order, trimmed, an ellipsis if it runs long
export function compactQuery(q: Query, max = 96): string {
  const s = Object.entries(q)
    .map(([k, v]) => (v === '' ? k : `${k}=${v.slice(0, 40)}`))
    .join('&');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
