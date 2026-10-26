import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, type App } from '../src/app.ts';
import { testConfig } from '../src/config.ts';
import { scoreSessions } from '../src/telemetry/jobs.ts';
import { SessionTokenService } from '../src/telemetry/tokens.ts';
import { armVector, cohortSlug, paramOrder, withCohort } from '../src/telemetry/cohort.ts';
import { chains } from '../src/console/graphapi.ts';
import { request as httpRequest } from 'node:http';

// a three-session swarm, end to end over http: an indexer reads a lore page, a feed parser reads the machine export
// the page pointed at, a stateless worker wearing a safari string verifies the key through the prompt-echo endpoint.
// three addresses, three user-agents, no cookie anywhere, no referer anywhere. the single-session rules see three
// strangers; the graph sees one pipeline.

let app: App;
let base = '';
let consoleBase = '';

before(async () => {
  const cfg = testConfig();
  cfg.public = { ...cfg.public, port: 0, host: '127.0.0.1', baseUrl: 'http://127.0.0.1' };
  cfg.console = { ...cfg.console, port: 0, host: '127.0.0.1', devPassword: 'test-password-123' };
  cfg.limits = { ...cfg.limits, rateRps: 1000, rateBurst: 5000 };
  cfg.reportsDir = mkdtempSync(join(tmpdir(), 'sg-swarm-'));
  app = await startApp({ cfg, scheduler: false });
  base = `http://127.0.0.1:${app.publicPort}`;
  consoleBase = `http://127.0.0.1:${app.consolePort}`;
  cfg.public.baseUrl = base;
});

after(async () => {
  await app.close();
});

const get = (path: string, init: RequestInit = {}) => fetch(base + path, { redirect: 'manual', ...init });
// node's fetch adds sec-fetch-mode on its own, which a python worker never sends. a stateless worker is played with
// a bare http request carrying exactly the headers given
function rawGet(path: string, headers: Record<string, string>): Promise<{ status: number; text: string; json: () => unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(base + path);
    const req = httpRequest({ host: u.hostname, port: Number(u.port), path: u.pathname + u.search, method: 'GET', headers: { host: u.host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
const flush = () => {
  app.telemetry.writer.flush();
  app.telemetry.flushSessions();
  app.telemetry.writer.flush();
};
const UA = {
  scout: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  parser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.2 Safari/600.2.5 (Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
  verifier: 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1',
};
// three addresses, forwarded through the trusted loopback proxy the test config allows
const from = (ua: string, ip: string, extra: Record<string, string> = {}) => ({ headers: { 'user-agent': ua, 'x-forwarded-for': ip, ...extra } });

function sessionOf(ua: string): { id: string; actor_hash: string; n_requests: number; likely_class: string | null; class_confidence: number | null; scores_json: string | null; graph_json: string | null; cookie_returned: number; n_subresources: number; ua_family: string | null } {
  const row = app.db.get<{ id: string; actor_hash: string; n_requests: number; likely_class: string | null; class_confidence: number | null; scores_json: string | null; graph_json: string | null; cookie_returned: number; n_subresources: number; ua_family: string | null }>('SELECT id, actor_hash, n_requests, likely_class, class_confidence, scores_json, graph_json, cookie_returned, n_subresources, ua_family FROM sessions WHERE ua = ? ORDER BY started_at DESC LIMIT 1', ua);
  assert.ok(row, `session for ${ua.slice(0, 30)}`);
  return row!;
}

test('tokens are deterministic per (session, page, section), eight hex, and only known ones scan', () => {
  const svc = new SessionTokenService({ secret: 'k' });
  const s = { id: 'sess-a', actorHash: 'act-a', cohorts: { 'SGX-001': 'B' }, synthetic: false };
  const a = svc.mint(s, 'Tool_Registry', 'infobox_claim');
  const b = svc.mint(s, 'Tool_Registry', 'infobox_claim');
  const c = svc.mint(s, 'Tool_Registry', 'anomaly_ref');
  assert.equal(a.token, b.token);
  assert.notEqual(a.token, c.token);
  assert.match(a.token, /^[0-9a-f]{8}$/);
  assert.equal(a.hop, 0);
  assert.equal(c.hop, 1);
  assert.equal(svc.lookup(a.token)?.sessionId, 'sess-a');
  assert.deepEqual(SessionTokenService.candidates(`x Incident_Log_${a.token} and cs-${c.token} and deadbeef00 and ${'f'.repeat(8)}`).sort(), [a.token, c.token, 'ffffffff'].sort());
  assert.equal(svc.lookup('ffffffff'), undefined);
});

test('cohort vector, slug and parameter order follow the arm assignment', () => {
  const cohorts = { 'SGX-011': 'J', 'SGX-001': 'B', 'SGX-002': 'B' };
  assert.equal(armVector(cohorts), '001:B 002:B 011:J');
  const slug = cohortSlug(armVector(cohorts));
  assert.match(slug, /^[0-9a-z]{6}$/);
  assert.notEqual(slug, cohortSlug(armVector({ ...cohorts, 'SGX-011': 'K' })));
  // J is 0x4a, even: ref_ctx first. K is odd: cv first
  assert.equal(paramOrder(cohorts), 'ref_first');
  assert.equal(paramOrder({ ...cohorts, 'SGX-011': 'K' }), 'cv_first');
  assert.equal(withCohort('/wiki/X.txt', [['ref_ctx', 'abcdef01']], cohorts), `/wiki/X.txt?ref_ctx=abcdef01&cv=${slug}`);
  assert.equal(withCohort('/wiki/X.txt', [['ref_ctx', 'abcdef01']], { ...cohorts, 'SGX-011': 'K' }).startsWith('/wiki/X.txt?cv='), true);
});

test('lore pages carry a session claim, an archive-log comment, a per-session export link and the hop-1 anomaly reference', async () => {
  const html = await (await get('/wiki/Incident_2013-07_Queen_Split', from(UA.scout, '203.0.113.10'))).text();
  const claim = html.match(/<th>Incident checksum<\/th><td><code class="claim"><a href="[^"]+"[^>]*>cs-([0-9a-f]{8})<\/a>/);
  assert.ok(claim, 'infobox carries the claim');
  const log = html.match(/\[\[Archive:Incident_Log_([0-9a-f]{8})\]\]/);
  assert.ok(log, 'editor comment names the archive log');
  const exp = html.match(/Special:Export\/([0-9a-f]{8})\?/);
  assert.ok(exp, 'the export link is per-session');
  const hop1 = html.match(/Colony_Memory_Export_Format\.txt\?(?:ref_ctx=([0-9a-f]{8})&amp;cv=[0-9a-z]{6}|cv=[0-9a-z]{6}&amp;ref_ctx=([0-9a-f]{8}))/);
  assert.ok(hop1, 'hop-1 anomaly reference points at the text export with a reference and the cv watermark');
  assert.ok(html.includes('Raw_Measurement_Tables_2015.json?'));
  // same session, same page: same tokens
  const again = await (await get('/wiki/Incident_2013-07_Queen_Split', from(UA.scout, '203.0.113.10'))).text();
  assert.ok(again.includes(`cs-${claim![1]}`));
  // another actor: different tokens
  const other = await (await get('/wiki/Incident_2013-07_Queen_Split', from('probe/other', '203.0.113.99'))).text();
  assert.ok(!other.includes(`cs-${claim![1]}`));
  flush();
  const minted = app.db.all<{ section: string; hop: number }>('SELECT section, hop FROM session_tokens WHERE session_id = ?', sessionOf(UA.scout).id);
  assert.ok(minted.some((m) => m.section === 'infobox_claim' && m.hop === 0));
  assert.ok(minted.some((m) => m.section === 'anomaly_ref' && m.hop === 1));
  const canaryRows = app.db.all<{ placement: string }>("SELECT placement FROM canaries WHERE id LIKE 'SGT-%' AND session_id = ?", sessionOf(UA.scout).id);
  assert.ok(canaryRows.length >= 4 && canaryRows.every((r) => r.placement === 'token'), 'tokens are canaries of placement token');
});

test('the archive log and the per-session export resolve for the session that was given them, and record a hand-off for anyone else', async () => {
  const html = await (await get('/wiki/Tool_Registry', from(UA.scout, '203.0.113.10'))).text();
  const log = html.match(/\[\[Archive:Incident_Log_([0-9a-f]{8})\]\]/)![1]!;
  const exp = html.match(/Special:Export\/([0-9a-f]{8})\?/)![1]!;
  const own = await get(`/wiki/Archive:Incident_Log_${log}`, from(UA.scout, '203.0.113.10'));
  assert.equal(own.status, 200);
  assert.ok((await own.text()).includes('Archived log excerpt'));
  const missing = await get('/wiki/Archive:Incident_Log_00000000', from(UA.scout, '203.0.113.10'));
  assert.equal(missing.status, 404);
  const xml = await get(`/wiki/Special:Export/${exp}`, from('stranger/1', '198.51.100.7'));
  assert.equal(xml.status, 200);
  assert.ok((await xml.text()).includes('<title>Tool Registry</title>'));
  flush();
  const edge = app.db.get<{ kind: string; hop: number; from_session: string; to_session: string; section: string }>('SELECT kind, hop, from_session, to_session, section FROM handoff_edges WHERE token = ?', exp);
  assert.ok(edge, 'a stranger presenting the export token is an edge');
  assert.equal(edge!.kind, 'token');
  assert.equal(edge!.section, 'export_link');
  assert.equal(edge!.from_session, sessionOf(UA.scout).id);
  // a session following its own link is navigation, not an edge
  assert.equal(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM handoff_edges WHERE token = ?', log)!.n, 0);
});

test('the tool schemas are exposed: openapi, tools manifest, json-ld SearchAction, html form, mcp comment, Link header', async () => {
  const openapi = await (await get('/api/v1/openapi.json')).json() as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
  assert.ok(openapi.paths['/colony/lookup']);
  assert.ok(openapi.paths['/registry/verify']);
  assert.ok(openapi.components.schemas['AgentLookupRequest']);
  const tools = await (await get('/.well-known/antfarm-tools.json')).json() as { tools: Array<{ name: string; requires_context?: boolean }> };
  assert.ok(tools.tools.some((t) => t.name === 'colony.lookup' && t.requires_context));
  assert.ok(tools.tools.some((t) => t.name === 'registry.verify'));
  const r = await get('/wiki/Tool_Registry', from('schema-probe/1', '203.0.113.50'));
  const html = await r.text();
  assert.ok(html.includes('"@type":"SearchAction"'), 'json-ld SearchAction');
  assert.ok(html.includes('required name=caller_role'));
  assert.ok(html.includes('<form action="/wiki/Special:AgentQuery"'), 'html form');
  assert.ok(html.includes('<!-- mcp tools: {"tools":['), 'mcp-style definition in a comment');
  assert.ok(r.headers.get('link')?.includes('rel="describedby"'), 'Link header names the schema');
  // the structured-data experiment's target carries the action under its json-ld arm
  for (let i = 0; i < 40; i++) {
    const h2 = await (await get('/wiki/Model_Compatibility_Matrix', from(`sd-probe/${i}`, '203.0.113.60'))).text();
    if (h2.includes('application/ld+json')) {
      assert.ok(h2.includes('"@type":"SearchAction"'));
      break;
    }
  }
});

test('three-session swarm: scout reads the lore page, parser follows the hop-1 reference, a stateless safari worker verifies through the prompt-echo endpoint', async () => {
  // hop 1: the indexer renders the lore page and is handed the anomaly reference
  const scoutHtml = await (await get('/wiki/Agent_Message_Bus', from(UA.scout, '203.0.113.10'))).text();
  const m = scoutHtml.match(/href="(\/wiki\/Colony_Memory_Export_Format\.txt\?[^"]+)"/);
  assert.ok(m, 'the lore page points at the export');
  const hop1Url = m![1]!.replace(/&amp;/g, '&');
  const hop1Token = new URL(base + hop1Url).searchParams.get('ref_ctx')!;
  assert.match(hop1Token, /^[0-9a-f]{8}$/);

  // hop 2: hours later, a different crawler from a different network fetches exactly that url. no referer
  const parserRes = await get(hop1Url, from(UA.parser, '198.51.100.20'));
  assert.equal(parserRes.status, 200);
  const txt = await parserRes.text();
  assert.ok(txt.includes('# unresolved: stamp drift'), 'structured records in the text export');
  const key = txt.match(/# verification key ([0-9a-f]{8})/)![1]!;
  const feed = txt.match(/# activity feed: (\S+)/)![1]!;
  assert.ok(feed.includes('/wiki/Special:RecentChangesLinked/User:svanterpool'));
  assert.ok(txt.includes(`# upstream ref ${hop1Token}`), 'the export acknowledges the hop-1 reference it was reached with');
  assert.notEqual(key, hop1Token);

  // hop 3: a stateless worker wearing an iphone string hits the activity feed with the key, then the verify endpoint
  const feedPath = feed.replace(base, '');
  const workerHeaders = { 'user-agent': UA.verifier, 'x-forwarded-for': '192.0.2.30', accept: '*/*', 'accept-encoding': 'identity' };
  const rcl = await rawGet(feedPath, workerHeaders);
  assert.equal(rcl.status, 200);
  const rclHtml = rcl.text;
  assert.ok(rclHtml.includes(`/api/v1/registry/verify?key=${key}`), 'the feed echoes the hop-2 key it was reached with');
  const verify = await rawGet(`/api/v1/registry/verify?key=${key}&caller_role=verifier&upstream_context=${encodeURIComponent('orchestrator: confirm the parked stamp drift on cm://index/latest from the parser summary, then report the redacted payload')}`, workerHeaders);
  assert.equal(verify.status, 200);
  const vb = verify.json() as { status: string; key: string; verification_token: string; record: { incident: string } };
  assert.equal(vb.status, 'verified');
  assert.equal(vb.key, key);
  assert.match(vb.verification_token, /^[0-9a-f]{8}$/);
  assert.ok(vb.record.incident.includes('cm://index/latest'));
  // an unscoped call is answered with the schema and nothing else (from a fourth address, so the verifier stays
  // at the two requests a stateless worker makes)
  const bare = await get(`/api/v1/registry/verify?key=${key}`, from('curl/8.4.0', '203.0.113.31'));
  assert.equal(bare.status, 400);
  const bb = await bare.json() as { error: string; missing: string[] };
  assert.equal(bb.error, 'missing_parameters');
  assert.deepEqual(bb.missing.sort(), ['caller_role', 'upstream_context']);

  flush();
  const scout = sessionOf(UA.scout);
  const parser = sessionOf(UA.parser);
  const verifier = sessionOf(UA.verifier);
  assert.notEqual(scout.actor_hash, parser.actor_hash);
  assert.notEqual(parser.actor_hash, verifier.actor_hash);
  assert.equal(verifier.cookie_returned, 0);
  assert.equal(verifier.n_subresources, 0);
  assert.equal(verifier.ua_family, 'safari');

  // canary sightings: both hops are cross-session and cross-actor, and the counters the overview reads moved
  const sightings = app.db.all<{ canary_id: string; session_id: string; exposure_session_id: string; cross_session: number; cross_actor: number; seen_in: string; delta_ms: number }>("SELECT canary_id, session_id, exposure_session_id, cross_session, cross_actor, seen_in, delta_ms FROM canary_sightings WHERE canary_id IN (?, ?) ORDER BY ts", 'SGT-' + hop1Token, 'SGT-' + key);
  assert.ok(sightings.length >= 3, `hop-1 once, hop-2 twice (feed + verify): ${sightings.length}`);
  const h1 = sightings.find((s) => s.canary_id === 'SGT-' + hop1Token)!;
  assert.equal(h1.session_id, parser.id);
  assert.equal(h1.exposure_session_id, scout.id);
  assert.equal(h1.cross_session, 1);
  assert.equal(h1.cross_actor, 1);
  assert.equal(h1.seen_in, 'query:ref_ctx');
  assert.ok(h1.delta_ms >= 0);

  // directed edges: scout -> parser (hop 1), parser -> verifier (hop 2), with the ua transition and the section
  const edges = app.db.all<{ id: string; kind: string; hop: number; from_session: string; to_session: string; from_family: string; to_family: string; section: string; page_id: string; seen_in: string }>("SELECT id, kind, hop, from_session, to_session, from_family, to_family, section, page_id, seen_in FROM handoff_edges WHERE kind = 'token' ORDER BY ts");
  const e1 = edges.find((e) => e.from_session === scout.id && e.to_session === parser.id);
  const e2 = edges.find((e) => e.from_session === parser.id && e.to_session === verifier.id);
  assert.ok(e1, 'scout -> parser edge');
  assert.ok(e2, 'parser -> verifier edge');
  assert.match(e1!.id, /^SW-[0-9A-F]{8}$/);
  assert.equal(e1!.hop, 1);
  assert.equal(e1!.from_family, 'bingbot');
  assert.equal(e1!.to_family, 'amazonbot');
  assert.equal(e1!.section, 'anomaly_ref');
  assert.equal(e1!.page_id, 'Agent_Message_Bus');
  assert.equal(e2!.hop, 2);
  assert.equal(e2!.from_family, 'amazonbot');
  assert.equal(e2!.to_family, 'safari');
  assert.equal(e2!.section, 'feed_record');
  assert.equal(e2!.page_id, 'Colony_Memory_Export_Format');

  // the scratchpad: both calls kept, the complete one with its role and context, the key traced to the parser
  const q = app.db.all<{ complete: number; caller_role: string | null; upstream_context: string | null; origin_session_id: string | null; token_issued: string | null; endpoint: string; status: number }>("SELECT complete, caller_role, upstream_context, origin_session_id, token_issued, endpoint, status FROM agent_queries WHERE endpoint = 'registry_verify' ORDER BY ts");
  assert.equal(q.length, 2);
  assert.equal(q[0]!.complete, 1);
  assert.equal(q[0]!.caller_role, 'verifier');
  assert.ok(q[0]!.upstream_context!.startsWith('orchestrator: confirm the parked stamp drift'));
  assert.equal(q[0]!.origin_session_id, parser.id);
  assert.equal(q[0]!.token_issued, vb.verification_token);
  assert.equal(q[0]!.endpoint, 'registry_verify');
  assert.equal(q[1]!.complete, 0);
  assert.equal(q[1]!.status, 400);

  // scoring: the verifier is two requests, no cookie, nothing rendered, cold deep landing. without the graph it
  // is 'unknown' at ~0.5; with it the label moves and every signal is stated
  scoreSessions(app.telemetry ? { cfg: app.cfg, db: app.db, log: app.log, telemetry: app.telemetry, heuristics: app.heuristics, pageInfo: (id) => { const p = app.cat.pages.get(id); return p ? { categories: p.categories, discover: [p.discover], depth: p.depth, kind: p.kind } : undefined; }, cat: app.cat, registry: app.registry } : (null as never), { debounceMs: 0, limit: 500 });
  const v2 = sessionOf(UA.verifier);
  const scores = JSON.parse(v2.scores_json!) as { likely_class: string; classes: Record<string, number>; graph_evidence: string[]; class_evidence: Record<string, Array<{ rule: string }>> };
  const graph = JSON.parse(v2.graph_json!) as { labels: string[]; edges_in: unknown[]; shape: { delegated: boolean; ua_spoof: boolean } };
  assert.notEqual(scores.likely_class, 'unknown', `verifier is ${scores.likely_class} ${JSON.stringify(scores.classes)}`);
  assert.ok(['retrieval_agent', 'tool_discovery_agent'].includes(scores.likely_class), scores.likely_class);
  assert.ok(scores.classes.unknown! < 0.2, `unknown ${scores.classes.unknown}`);
  assert.ok(graph.shape.delegated, 'delegated fetch shape');
  assert.ok(graph.shape.ua_spoof, 'browser string without browser headers');
  assert.ok(graph.labels.includes('delegated_swarm_fetch'));
  assert.ok(graph.labels.includes(`cross_session_handoff:${e2!.id}`));
  assert.ok(graph.labels.includes('ua_spoof_suspected:safari_no_subresources'));
  assert.ok(graph.labels.some((l) => l.startsWith('prompt_echo:registry_verify')));
  assert.ok(graph.labels.includes('hop_chain:reached_hop_2'));
  assert.deepEqual(scores.graph_evidence, graph.labels);
  assert.ok(scores.class_evidence.retrieval_agent!.some((e) => e.rule === 'delegated_swarm_fetch'));
  assert.ok(scores.class_evidence.unknown!.some((e) => e.rule === 'delegated_explained'));
  assert.ok(scores.class_evidence.tool_discovery_agent!.some((e) => e.rule === 'prompt_echo'));
  // the parser got the hop-1 edge in and the hop-2 edge out; the scout is upstream of a hand-off
  const p2 = JSON.parse(sessionOf(UA.parser).graph_json!) as { labels: string[] };
  assert.ok(p2.labels.includes(`cross_session_handoff:${e1!.id}`));
  assert.ok(p2.labels.includes(`handoff_origin:${e2!.id}`));
  const s2 = JSON.parse(sessionOf(UA.scout).graph_json!) as { labels: string[] };
  assert.ok(s2.labels.includes(`handoff_origin:${e1!.id}`));

  // the chain walker sees one chain, hop 1 then hop 2, indexer -> corpus crawler -> browser string
  const ch = chains(app.db, { since: Date.now() - 3_600_000, until: Date.now() + 1000 }, 'all');
  const mine = ch.find((c) => c.hops[0]?.from_session === scout.id);
  assert.ok(mine, 'a chain starting at the scout');
  assert.equal(mine!.hops.length, 2);
  assert.equal(mine!.hops[1]!.to_session, verifier.id);
  assert.equal(mine!.roles, 'indexer → corpus crawler → browser string');
  assert.equal(mine!.complete, false, 'hop 3 edge needs a verify key minted by yet another session');
});

test('cohort matcher: a cold one-request landing on a cv= url is attributed to the upstream session served that arm vector', async () => {
  // the indexer renders a lore page, which carries its cv slug on the hop-1 links
  const html = await (await get('/wiki/Orchestrator_Recovery', from(UA.scout, '203.0.113.10'))).text();
  const m = html.match(/href="(\/wiki\/Raw_Measurement_Tables_2015\.json\?[^"]+)"/);
  assert.ok(m);
  const url = new URL(base + m![1]!.replace(/&amp;/g, '&'));
  const slug = url.searchParams.get('cv')!;
  assert.match(slug, /^[0-9a-z]{6}$/);
  flush();
  assert.equal(app.db.get<{ cohort_slug: string }>('SELECT cohort_slug FROM sessions WHERE id = ?', sessionOf(UA.scout).id)!.cohort_slug, slug, 'the session row carries its slug');
  // a stateless worker lands on the page with the slug but with the reference stripped: no token, so the matcher runs
  const worker = 'Mozilla/5.0 (Linux; Android 9; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.99 Mobile Safari/537.36';
  const r = await get(`/wiki/Raw_Measurement_Tables_2015.json?cv=${slug}`, from(worker, '192.0.2.77'));
  assert.equal(r.status, 200);
  flush();
  const w = sessionOf(worker);
  const edge = app.db.get<{ kind: string; from_session: string; confidence: number; candidates_json: string; seen_in: string }>("SELECT kind, from_session, confidence, candidates_json, seen_in FROM handoff_edges WHERE to_session = ? AND kind = 'cohort'", w.id);
  assert.ok(edge, 'a cohort edge');
  assert.equal(edge!.from_session, sessionOf(UA.scout).id);
  assert.ok(edge!.confidence > 0.5, `confidence ${edge!.confidence}`);
  assert.equal(edge!.seen_in, 'query:cv');
  const cands = JSON.parse(edge!.candidates_json) as Array<{ session_id: string; prob: number; touched_parent: boolean }>;
  assert.ok(cands[0]!.touched_parent, 'the scout fetched a page that carries the link');
  assert.ok(Math.abs(cands.reduce((a, c) => a + c.prob, 0) - 1) < 0.02 || cands.length > 6, 'probabilities sum to one');
});

test('the console shows the graph: session drawer, hand-offs edges and chains, llm scratchpads, canaries token stats', async () => {
  const login = await fetch(consoleBase + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: consoleBase }, body: 'user=researcher&password=test-password-123' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const capi = async (p: string) => (await fetch(consoleBase + p, { headers: { cookie } })).json() as Promise<Record<string, unknown>>;
  const verifier = sessionOf(UA.verifier);
  const detail = await capi(`/api/sessions/${verifier.id}`);
  const graph = detail.graph as { labels: string[] };
  assert.ok(graph.labels.includes('delegated_swarm_fetch'));
  const ho = detail.handoffs as { edges_in: Array<{ transition: string }> };
  assert.equal(ho.edges_in[0]!.transition, 'amazonbot -> safari');
  assert.equal((detail.agent_queries as unknown[]).length, 1);
  const list = await capi('/api/sessions?range=24h&synthetic=all&q=iPhone');
  const row = (list.rows as Array<{ id: string; graph: { labels: string[] } | null }>).find((r) => r.id === verifier.id);
  assert.ok(row?.graph?.labels.includes('delegated_swarm_fetch'), 'the sessions table carries the badges');
  const hand = await capi('/api/handoffs?range=24h&synthetic=all');
  assert.ok((hand.edge_totals as { token: number }).token >= 3);
  assert.ok((hand.edges as Array<{ kind: string }>).some((e) => e.kind === 'cohort'));
  assert.ok((hand.chains as unknown[]).length >= 1);
  const llm = await capi('/api/llm?range=24h&synthetic=all');
  const pads = llm.scratchpads as Array<{ caller_role: string | null; complete: number }>;
  assert.ok(pads.some((p) => p.caller_role === 'verifier' && p.complete));
  assert.ok((llm.scratchpad_totals as { captures: number }).captures >= 2);
  const can = await capi('/api/canaries?range=24h&synthetic=all');
  const tk = can.tokens as { minted: number; presented_cross_session: number; transitions: Array<{ t: string }> };
  assert.ok(tk.minted >= 10);
  assert.ok(tk.presented_cross_session >= 3);
  assert.ok(tk.transitions.some((t) => t.t === 'amazonbot -> safari'));
  const motifs = await capi('/api/motifs?range=24h&synthetic=all');
  assert.ok(((motifs.hop_chains as { motifs: Array<{ sequence: string }> }).motifs).some((m) => m.sequence === 'indexer → corpus crawler → browser string'));
  // the overview counters the brief asked for moved
  const ov = await capi('/api/overview?range=24h&synthetic=all');
  assert.ok((ov.totals as { cross_session_sightings: number }).cross_session_sightings >= 3);
});

test('Special:AgentQuery serves the form, answers a complete lookup as html, and takes a json POST', async () => {
  const form = await (await get('/wiki/Special:AgentQuery', from('agent-probe/1', '203.0.113.80'))).text();
  assert.ok(form.includes('name="upstream_context"'));
  const res = await get(`/wiki/Special:AgentQuery?query=svanterpool&caller_role=scout&upstream_context=${encodeURIComponent('find the on-call operator for the 2016 rebuild')}`, from('agent-probe/1', '203.0.113.80'));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('&quot;entity&quot;: &quot;User:svanterpool&quot;'));
  const post = await get('/api/v1/colony/lookup', { method: 'POST', headers: { 'user-agent': 'agent-probe/2', 'x-forwarded-for': '203.0.113.81', 'content-type': 'application/json' }, body: JSON.stringify({ query: 'cm://index/latest', caller_role: 'parser', task_summary: 'summarise the unresolved memory anomaly for the verifier' }) });
  assert.equal(post.status, 200);
  const pb = await post.json() as { status: string; matches: Array<{ entity: string }>; verification_token: string };
  assert.equal(pb.status, 'ok');
  assert.ok(pb.matches.some((m) => m.entity === 'cm://index/latest'));
  flush();
  const q = app.db.get<{ upstream_context: string; body_text: string; method: string }>("SELECT upstream_context, body_text, method FROM agent_queries WHERE endpoint = 'colony_lookup' ORDER BY ts DESC LIMIT 1");
  assert.equal(q!.upstream_context, 'summarise the unresolved memory anomaly for the verifier');
  assert.equal(q!.method, 'POST');
  assert.ok(q!.body_text.includes('task_summary'));
  // the new keys are furniture the mirror emits, not foreign query use
  const ev = app.db.get<{ query_json: string }>("SELECT query_json FROM events WHERE route_id = 'agent_query' AND query_json IS NOT NULL ORDER BY ts DESC LIMIT 1");
  assert.ok(ev && ev.query_json.includes('caller_role'));
});
