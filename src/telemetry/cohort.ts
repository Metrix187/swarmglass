import { fnv1a } from '../util/hash.ts';
import type { Db } from '../db/db.ts';
import { familyCategory } from './ua.ts';

// the nine active experiments give every actor an arm vector like "001:B 002:A 003:B ... 012:C". that is a few
// thousand distinct combinations, which is plenty to tell "which upstream session was served this" when a cold
// one-request fetcher turns up with a url it could only have been handed. the vector rides in the urls we plant
// as a six character slug (cv=), and the order of the query parameters follows one arm too, so even a url with
// the slug stripped still says something about who rendered it.

export function armVector(cohorts: Record<string, string> | null | undefined): string {
  if (!cohorts) return '';
  return Object.keys(cohorts)
    .sort()
    .map((k) => `${k.replace(/^SGX-/, '')}:${cohorts[k]}`)
    .join(' ');
}

// no secret in here on purpose: the console has to compute it from cohorts_json to match, and nothing about an
// arm vector is sensitive. six base36 characters over a few thousand vectors leaves collisions off the table
export function cohortSlug(vector: string): string {
  if (!vector) return '';
  return fnv1a('cv|' + vector).toString(36).padStart(7, '0').slice(0, 6);
}

export function slugFor(cohorts: Record<string, string> | null | undefined): string {
  return cohortSlug(armVector(cohorts));
}

// which parameter comes first. the metadata-carrier arm decides when it exists (eleven arms, so this varies a
// lot), the vector hash otherwise
export function paramOrder(cohorts: Record<string, string> | null | undefined): 'ref_first' | 'cv_first' {
  const arm = cohorts?.['SGX-011'];
  const n = arm ? arm.charCodeAt(0) : fnv1a(armVector(cohorts));
  return n % 2 === 0 ? 'ref_first' : 'cv_first';
}

export function withCohort(path: string, params: Array<[string, string]>, cohorts: Record<string, string> | null | undefined): string {
  const slug = slugFor(cohorts);
  const pairs: Array<[string, string]> = slug ? (paramOrder(cohorts) === 'cv_first' ? [['cv', slug], ...params] : [...params, ['cv', slug]]) : params;
  if (!pairs.length) return path;
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export interface Candidate {
  session_id: string;
  actor_hash: string;
  ua_family: string | null;
  likely_class: string | null;
  started_at: number;
  last_seen_at: number;
  same_actor: boolean;
  touched_parent: boolean;
  prob: number;
}

export interface CohortMatch {
  method: 'cohort' | 'precursor';
  slug: string | null;
  candidates: Candidate[]; // sorted, probabilities sum to 1 over everything considered, top few kept
  considered: number;
  top: Candidate | null;
}

const HALF_LIFE_MS = 6 * 3_600_000;

function recency(ageMs: number): number {
  return Math.pow(0.5, Math.max(0, ageMs) / HALF_LIFE_MS);
}

function normalise(rows: Candidate[], weights: number[], method: CohortMatch['method'], slug: string | null): CohortMatch {
  const total = weights.reduce((a, b) => a + b, 0);
  const out = rows.map((r, i) => ({ ...r, prob: total ? Math.round(((weights[i] as number) / total) * 1000) / 1000 : 0 })).sort((a, b) => b.prob - a.prob);
  return { method, slug, candidates: out.slice(0, 6), considered: rows.length, top: out[0] ?? null };
}

// sessions that were served this exact arm vector inside the window, weighted by how recently they were here and
// by whether they fetched a page that could have carried the url (the parents the caller passes in). the fetcher's
// own cohort is never consulted: F-001's lesson was that the fetching address draws its own arm and it means nothing
export function attributeBySlug(db: Db, opts: { slug: string; ts: number; sessionId: string; actorHash: string; parents: string[]; windowMs?: number }): CohortMatch {
  const since = opts.ts - (opts.windowMs ?? 72 * 3_600_000);
  const rows = db.all<{ id: string; actor_hash: string; ua_family: string | null; likely_class: string | null; started_at: number; last_seen_at: number }>(
    'SELECT id, actor_hash, ua_family, likely_class, started_at, last_seen_at FROM sessions WHERE cohort_slug = ? AND started_at >= ? AND started_at <= ? AND id != ? ORDER BY last_seen_at DESC LIMIT 200',
    opts.slug, since, opts.ts, opts.sessionId,
  );
  if (!rows.length) return { method: 'cohort', slug: opts.slug, candidates: [], considered: 0, top: null };
  const parentSet = new Set(opts.parents);
  const touched = new Set<string>();
  if (parentSet.size) {
    for (const chunk of chunks(rows.map((r) => r.id), 400)) {
      for (const d of db.all<{ session_id: string; page_id: string }>(`SELECT session_id, page_id FROM page_discoveries WHERE session_id IN (${chunk.map(() => '?').join(',')})`, ...chunk)) {
        if (parentSet.has(d.page_id)) touched.add(d.session_id);
      }
    }
  }
  const cands: Candidate[] = rows.map((r) => ({ session_id: r.id, actor_hash: r.actor_hash, ua_family: r.ua_family, likely_class: r.likely_class, started_at: r.started_at, last_seen_at: r.last_seen_at, same_actor: r.actor_hash === opts.actorHash, touched_parent: touched.has(r.id), prob: 0 }));
  const weights = cands.map((c) => recency(opts.ts - c.last_seen_at) * (c.touched_parent ? 3 : 1));
  return normalise(cands, weights, 'cohort', opts.slug);
}

// no slug to go on: who fetched this page before, from another address, declaring itself a crawler? an indexer
// that read the page hours ago and a stateless worker fetching it now is the shape the swarm has
export function attributeByPrecursor(db: Db, opts: { pageId: string; ts: number; sessionId: string; actorHash: string; windowMs?: number }): CohortMatch {
  const since = opts.ts - (opts.windowMs ?? 72 * 3_600_000);
  const rows = db.all<{ id: string; actor_hash: string; ua_family: string | null; likely_class: string | null; started_at: number; last_seen_at: number; seen: number }>(
    'SELECT s.id, s.actor_hash, s.ua_family, s.likely_class, s.started_at, s.last_seen_at, pd.ts AS seen FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.page_id = ? AND pd.ts >= ? AND pd.ts <= ? AND s.id != ? AND s.actor_hash != ? ORDER BY pd.ts DESC LIMIT 200',
    opts.pageId, since, opts.ts, opts.sessionId, opts.actorHash,
  );
  const crawlers = rows.filter((r) => ['search', 'ai_crawler', 'seo'].includes(familyCategory(r.ua_family)));
  if (!crawlers.length) return { method: 'precursor', slug: null, candidates: [], considered: rows.length, top: null };
  const cands: Candidate[] = crawlers.map((r) => ({ session_id: r.id, actor_hash: r.actor_hash, ua_family: r.ua_family, likely_class: r.likely_class, started_at: r.started_at, last_seen_at: r.seen, same_actor: false, touched_parent: true, prob: 0 }));
  const weights = cands.map((c) => recency(opts.ts - c.last_seen_at));
  return normalise(cands, weights, 'precursor', null);
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
