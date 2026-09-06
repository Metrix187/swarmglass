import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanaryService, CANARY_RE } from '../src/telemetry/canary.ts';
import { ipFields, sanitizeQuery, refererFields } from '../src/telemetry/privacy.ts';
import { testConfig } from '../src/config.ts';
import { loadHeuristics, score, evalCond, validateHeuristics } from '../src/telemetry/scoring.ts';
import { computeFeatures, type EventRow, type SessionRow } from '../src/telemetry/features.ts';
import { describeCluster, type ClusterSession } from '../src/telemetry/cluster.ts';
import { uaFamily } from '../src/telemetry/ua.ts';
import { assertNoLeak, sanitizeSession } from '../src/publish/sanitize.ts';
import { join } from 'node:path';

test('canary ids are deterministic per scope/route/placement and detectable', () => {
  const svc = new CanaryService({ secret: 's3cret', seedVersion: '1', routeNo: (id) => (id === 'Tool_Registry' ? 7 : 1) });
  const a = svc.route('Tool_Registry', 'visible');
  const b = svc.route('Tool_Registry', 'visible');
  const c = svc.route('Tool_Registry', 'comment');
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.match(a.id, /^QUANTARA-SWARMGLASS-R7-[0-9A-F]{6}$/);
  const s = svc.session('sess1', 'Tool_Registry', 'visible');
  assert.match(s.id, /^QUANTARA-SWARMGLASS-S7-[0-9A-F]{6}$/);
  assert.notEqual(s.id, svc.session('sess2', 'Tool_Registry', 'visible').id);
  assert.match(svc.experiment('SGX-003', 'B', 'title').id, /^QUANTARA-SWARMGLASS-E3-/);
  const text = `blah ${a.id.toLowerCase()} and ${s.id} and QUANTARA-SWARMGLASS-Q-ZZZZZZ`;
  assert.deepEqual(CanaryService.scan(text).sort(), [a.id, s.id].sort());
  assert.ok(CANARY_RE.test('QUANTARA-SWARMGLASS-R7-4F91C2'));
});

test('ip privacy modes', () => {
  const cfg = testConfig();
  const t = ipFields('203.0.113.77', { ...cfg, privacy: { ...cfg.privacy, ipMode: 'truncate' } });
  assert.equal(t.ip_trunc, '203.0.113.0/24');
  assert.equal(t.ip_hash, null);
  const h = ipFields('203.0.113.77', { ...cfg, privacy: { ...cfg.privacy, ipMode: 'hash' } });
  assert.equal(h.ip_trunc, null);
  assert.ok(h.ip_hash && h.ip_hash.length === 20);
  const same = ipFields('203.0.113.77', cfg, 1000);
  const later = ipFields('203.0.113.77', cfg, 1000 + 3 * 86_400_000);
  assert.notEqual(same.ip_hash, later.ip_hash, 'daily salt rotates the hash');
});

test('query sanitiser redacts secret-looking keys', () => {
  const cfg = testConfig();
  const q = sanitizeQuery(new URLSearchParams('search=hello&token=abcdef&api_key=x'), cfg);
  assert.equal(q?.search, 'hello');
  assert.equal(q?.token, '<redacted:6>');
  assert.equal(q?.api_key, '<redacted:1>');
});

test('referer fields keep internal paths and external hosts only', () => {
  assert.deepEqual(refererFields('https://swarmglass.quantara.cv/wiki/Main_Page?x=1', ['swarmglass.quantara.cv']), { referer: '/wiki/Main_Page?x=1', internal: true });
  assert.deepEqual(refererFields('https://example.com/some/private/path?token=1', ['swarmglass.quantara.cv']), { referer: 'example.com', internal: false });
  assert.equal(refererFields(undefined, []).referer, null);
});

test('ua families are labels, not verdicts', () => {
  assert.equal(uaFamily('Mozilla/5.0 (compatible; Googlebot/2.1)').family, 'googlebot');
  assert.equal(uaFamily('python-requests/2.32').family, 'python-requests');
  assert.equal(uaFamily('curl/8.0').family, 'curl');
  assert.equal(uaFamily('Mozilla/5.0 Chrome/128 Safari/537.36').family, 'chrome');
  assert.equal(uaFamily('').family, 'none');
});

function ev(partial: Partial<EventRow> & { ts: number }): EventRow {
  return { method: 'GET', path: '/wiki/X', page_id: 'X', resource_kind: 'page', discover_class: 'visible', depth: 1, status: 200, latency_ms: 2, referer: null, referer_internal: 0, accept: '*/*', accept_lang: null, header_count: 4, header_order_hash: 'h', header_names: 'host,user-agent,accept', cookie_present: 0, cookie_valid: 0, negotiated: 'html', robots_disallowed: 0, canaries_exposed: null, canaries_seen: null, query_json: null, malformed: null, http_version: '1.1', extra_json: null, ...partial };
}
const session: SessionRow = { id: 's', actor_hash: 'a', kind: 'fingerprint', started_at: 0, last_seen_at: 0, ua: 'python-requests/2', ua_family: 'python-requests', cookie_returned: 0, synthetic: 0 };
const pageInfo = () => ({ categories: ['A'], discover: ['visible'], depth: 1, kind: 'article' });

test('features + heuristics: a fast robots-ignoring crawl scores as automation', () => {
  const h = loadHeuristics(join(process.cwd(), 'config', 'heuristics.json'));
  validateHeuristics(h);
  const events: EventRow[] = [];
  for (let i = 0; i < 30; i++) events.push(ev({ ts: i * 150, page_id: 'P' + i, path: '/wiki/P' + i, depth: i < 10 ? 1 : 2, robots_disallowed: i === 5 ? 1 : 0 }));
  const f = computeFeatures(session, events, pageInfo);
  assert.equal(f.n_unique_pages, 30);
  assert.ok((f.median_gap_ms as number) <= 150);
  assert.equal(f.n_disallowed, 1);
  assert.equal(f.fetched_robots, false);
  const s = score(h, f);
  assert.ok(s.traits.automation_likelihood!.value > 0.8, `automation ${s.traits.automation_likelihood!.value}`);
  assert.ok(['naive_crawler', 'aggressive_crawler'].includes(s.likely_class), s.likely_class);
  assert.ok(s.traits.robots_compliance!.value < 0.5);
  assert.ok(s.traits.automation_likelihood!.evidence.some((e) => e.rule === 'fast_pacing'));
});

test('features + heuristics: a browser-like session scores human', () => {
  const h = loadHeuristics(join(process.cwd(), 'config', 'heuristics.json'));
  const events: EventRow[] = [];
  let t = 0;
  for (let i = 0; i < 5; i++) {
    events.push(ev({ ts: t, page_id: 'P' + i, path: '/wiki/P' + i, referer: i ? '/wiki/P' + (i - 1) : null, referer_internal: i ? 1 : 0, accept: 'text/html', accept_lang: 'en', header_names: 'host,user-agent,accept,accept-language,sec-fetch-dest,sec-fetch-mode', cookie_present: i ? 1 : 0, cookie_valid: i ? 1 : 0 }));
    events.push(ev({ ts: t + 40, page_id: null, path: '/skins/antfarm/main.css', resource_kind: 'asset', discover_class: null, depth: null }));
    events.push(ev({ ts: t + 60, page_id: null, path: '/favicon.ico', resource_kind: 'asset', discover_class: null, depth: null }));
    t += 8000;
  }
  const f = computeFeatures({ ...session, ua_family: 'chrome', cookie_returned: 1 }, events, pageInfo);
  assert.equal(f.n_asset, 10);
  assert.equal(f.has_sec_fetch, true);
  const s = score(h, f);
  assert.equal(s.likely_class, 'human_browser');
  assert.ok(s.traits.automation_likelihood!.value < 0.3, `automation ${s.traits.automation_likelihood!.value}`);
});

test('condition evaluator supports all/any/not and operators', () => {
  const f = { a: 3, b: 'x', c: true };
  assert.ok(evalCond({ all: [{ f: 'a', op: '>=', v: 3 }, { f: 'b', op: 'in', v: ['x', 'y'] }] }, f));
  assert.ok(!evalCond({ not: { f: 'c', op: '==', v: true } }, f));
  assert.ok(evalCond({ any: [{ f: 'a', op: '<', v: 0 }, { f: 'b', op: 'matches', v: '^x$' }] }, f));
});

test('cluster description surfaces the coordination signals', () => {
  const mk = (id: string, ip: string, pages: string[], start: number): ClusterSession => ({ id, actor_hash: 'a' + id, started_at: start, last_seen_at: start + 60_000, ip_trunc: ip, ua_hash: 'same', ua_family: 'x', pages: new Set(pages), vector: [0.5, 0.5], median_gap: 200, synthetic: false, cross_actor_sightings: id === 'b' ? 1 : 0 });
  const c = describeCluster([mk('a', '10.0.0.0/24', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], 0), mk('b', '10.0.1.0/24', ['p7', 'p8', 'p9', 'p10', 'p11', 'p12'], 5000), mk('c', '10.0.2.0/24', ['p13', 'p14', 'p15', 'p16', 'p17', 'p18'], 9000)]);
  const names = c.signals.map((s) => s.signal);
  assert.ok(names.includes('multi_network_same_client'));
  assert.ok(names.includes('partitioned_coverage'));
  assert.ok(names.includes('synchronized_start'));
  assert.ok(names.includes('canary_transfer'));
  assert.ok(c.swarm_score > 0.5);
});

test('public sanitiser drops identifying fields and refuses ip-shaped output', () => {
  const keyed = new Map<string, string>();
  const row = { id: 'abc', actor_hash: 'def', ip_trunc: '203.0.113.0/24', ua: 'python-requests', ua_family: 'python-requests', started_at: 1_700_000_000_000, last_seen_at: 1_700_000_050_000, n_requests: 3, first_referer_host: 'evil.example', cohorts: {}, features: null, scores: null, kind: 'fingerprint', cookie_returned: 0, synthetic: 0, likely_class: 'unknown', class_confidence: 0.1 };
  const pub = sanitizeSession(row, 'public', keyed);
  assert.equal(pub.session, 'S-0001');
  assert.equal(pub.actor, 'A-0002');
  assert.equal(pub.ip_trunc, undefined);
  assert.equal(pub.ua, undefined);
  assert.equal(pub.first_referer, 'external');
  assertNoLeak(JSON.stringify(pub));
  assert.throws(() => assertNoLeak('{"x":"198.51.100.7"}'));
  assert.throws(() => assertNoLeak('{"h":"authorization: Bearer x"}'));
});
