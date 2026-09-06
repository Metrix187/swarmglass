// what leaves the database for publication. allowlists, not denylists — a new column
// is invisible to exports until someone adds it here on purpose.

export type Level = 'public' | 'internal';

// consistent short labels for ids inside one export, never across exports
export function relabel(map: Map<string, string>, prefix: string, id: string | null | undefined): string | null {
  if (!id) return null;
  const hit = map.get(prefix + id);
  if (hit) return hit;
  const label = `${prefix}-${String(map.size + 1).padStart(4, '0')}`;
  map.set(prefix + id, label);
  return label;
}

const SESSION_PUBLIC = ['kind', 'started_at', 'last_seen_at', 'ended_at', 'ua_family', 'cookie_returned', 'n_requests', 'n_pages', 'n_unique_pages', 'n_errors', 'n_head', 'n_post', 'n_disallowed', 'n_subresources', 'n_machine', 'max_depth', 'first_path', 'last_path', 'synthetic', 'synthetic_persona', 'likely_class', 'class_confidence'] as const;

export function sanitizeSession(row: Record<string, unknown>, level: Level, keyed: Map<string, string>, index = 0): Record<string, unknown> {
  const out: Record<string, unknown> = { session: relabel(keyed, 'S', String(row.id)), actor: relabel(keyed, 'A', String(row.actor_hash)), n: index };
  for (const k of SESSION_PUBLIC) if (k in row) out[k] = row[k];
  // times relative to the export's earliest session keep ordering without leaking exact clock time at public level
  if (level === 'public') {
    out.started_at = new Date(Number(row.started_at)).toISOString().slice(0, 13) + ':00:00Z'; // hour resolution
    out.duration_ms = Number(row.last_seen_at) - Number(row.started_at);
    delete out.last_seen_at;
    delete out.ended_at;
    out.first_referer = row.first_referer_host ? 'external' : null;
  } else {
    out.ip_trunc = row.ip_trunc ?? null;
    out.ua = row.ua ?? null;
    out.first_referer_host = row.first_referer_host ?? null;
    out.cluster = row.cluster_id ?? null;
  }
  out.cohorts = row.cohorts ?? null;
  out.features = row.features ?? null;
  out.scores = row.scores ?? null;
  return out;
}

const EVENT_PUBLIC = ['method', 'path', 'route_id', 'page_id', 'resource_kind', 'discover_class', 'depth', 'status', 'negotiated', 'robots_disallowed', 'cookie_present', 'cookie_valid', 'referer_internal', 'synthetic'] as const;

export function sanitizeEvents(rows: Record<string, unknown>[], level: Level, keyed: Map<string, string>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const t0 = new Map<string, number>();
  for (const r of rows) {
    const sid = String(r.session_id);
    if (!t0.has(sid)) t0.set(sid, Number(r.ts));
    const e: Record<string, unknown> = { session: relabel(keyed, 'S', sid), rel_ms: Number(r.ts) - (t0.get(sid) as number) };
    for (const k of EVENT_PUBLIC) if (k in r) e[k] = r[k];
    e.latency_bucket = bucketLatency(Number(r.latency_ms));
    e.canaries_exposed = r.canaries_exposed ? JSON.parse(String(r.canaries_exposed)) : null;
    e.canaries_seen = r.canaries_seen ? (JSON.parse(String(r.canaries_seen)) as Array<{ id: string; where: string }>).map((s) => ({ id: s.id, where: s.where.split(':')[0] })) : null;
    e.malformed = r.malformed ? JSON.parse(String(r.malformed)) : null;
    e.query_keys = r.query_json ? Object.keys(JSON.parse(String(r.query_json))) : null;
    if (level === 'internal') {
      e.ts = r.ts;
      e.accept = r.accept;
      e.referer = r.referer;
      e.header_names = r.header_names;
      e.header_count = r.header_count;
      e.http_version = r.http_version;
      e.query = r.query_json ? JSON.parse(String(r.query_json)) : null;
    } else {
      // public: internal referers only as page ids, never external hosts
      e.referer_page = r.referer_internal && typeof r.referer === 'string' ? (r.referer as string).replace(/^.*\/wiki\//, '').split('?')[0] : null;
      e.accept_profile = r.extra_json ? (JSON.parse(String(r.extra_json)) as { accept_profile?: string }).accept_profile ?? null : null;
    }
    out.push(e);
  }
  return out;
}

export function sanitizeSightings(rows: Record<string, unknown>[], level: Level, keyed: Map<string, string>): Record<string, unknown>[] {
  return rows.map((r) => ({
    ts: level === 'internal' ? r.ts : new Date(Number(r.ts)).toISOString().slice(0, 13) + ':00:00Z',
    canary_id: r.canary_id,
    session: relabel(keyed, 'S', r.session_id ? String(r.session_id) : null),
    exposure_session: relabel(keyed, 'S', r.exposure_session_id ? String(r.exposure_session_id) : null),
    seen_in: String(r.seen_in).split(':')[0] + (String(r.seen_in).startsWith('external') ? ':' + String(r.seen_in).split(':')[1] : ''),
    cross_session: r.cross_session,
    cross_actor: r.cross_actor,
    external: r.external,
    delta_ms: r.delta_ms,
    synthetic: r.synthetic,
    ...(level === 'internal' ? { path: r.path, detail: r.detail } : {}),
  }));
}

function bucketLatency(ms: number): string {
  if (ms < 5) return '<5ms';
  if (ms < 20) return '5-20ms';
  if (ms < 100) return '20-100ms';
  if (ms < 500) return '100-500ms';
  return '>500ms';
}

// belt and braces: refuse to emit anything that looks like an address, a secret, or a raw header dump
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i;
const SECRETISH = /(authorization|cookie:|bearer |api[_-]?key|x-forwarded-for|cf-connecting-ip)/i;
const CIDR_OK = /\b(?:\d{1,3}\.){3}0\/24\b/; // a truncated /24 is allowed at internal level only, but public asserts run on public exports

export function assertNoLeak(serialized: string): void {
  // the fictional seed contains 192.0.2.x / 198.51.100.x documentation addresses inside page text; those
  // never appear in exports because page bodies are not exported. anything ip-shaped here is a bug.
  const v4 = serialized.match(IPV4);
  if (v4 && !CIDR_OK.test(v4[0])) throw new Error(`export sanitizer: ipv4-looking token in public export (${v4[0]})`);
  if (IPV6.test(serialized.replace(/QUANTARA-SWARMGLASS-[A-Z0-9-]+/g, ''))) throw new Error('export sanitizer: ipv6-looking token in public export');
  if (SECRETISH.test(serialized)) throw new Error('export sanitizer: header/secret-looking token in public export');
}
