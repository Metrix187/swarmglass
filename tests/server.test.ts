import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, type App } from '../src/app.ts';
import { testConfig } from '../src/config.ts';
import { scoreSessions, runClustering } from '../src/telemetry/jobs.ts';
import { pageInfoFor } from '../src/wiki/content.ts';
import { runSynthetic } from '../src/synth/run.ts';
import { generateReport } from '../src/publish/report.ts';
import { CanaryService } from '../src/telemetry/canary.ts';

// end-to-end: boot the whole app on ephemeral ports with an in-memory db and drive it over http.

let app: App;
let base = '';
let consoleBase = '';

before(async () => {
  const cfg = testConfig();
  cfg.public = { ...cfg.public, port: 0, host: '127.0.0.1', baseUrl: 'http://127.0.0.1' };
  cfg.console = { ...cfg.console, port: 0, host: '127.0.0.1', devPassword: 'test-password-123' };
  cfg.limits = { ...cfg.limits, rateRps: 1000, rateBurst: 5000 };
  app = await startApp({ cfg, scheduler: false });
  base = `http://127.0.0.1:${app.publicPort}`;
  consoleBase = `http://127.0.0.1:${app.consolePort}`;
  // the port is only known now; absolute urls in sitemaps/feeds/json-ld should point at ourselves
  cfg.public.baseUrl = base;
});

after(async () => {
  await app.close();
});

const get = (path: string, init: RequestInit = {}) => fetch(base + path, { redirect: 'manual', ...init });
const flush = () => {
  app.telemetry.writer.flush();
  app.telemetry.flushSessions();
  app.telemetry.writer.flush();
};

test('root redirects to the main page and the main page renders the skin', async () => {
  const r = await get('/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/wiki/Main_Page');
  const m = await get('/wiki/Main_Page');
  assert.equal(m.status, 200);
  const html = await m.text();
  assert.ok(html.includes('ANTFARM Wiki'));
  assert.ok(html.includes('id="p-cactions"'));
  assert.ok(html.includes('archive-ref'));
  assert.match(html, /QUANTARA-SWARMGLASS-R\d+-[0-9A-F]{6}/);
  assert.ok(m.headers.get('set-cookie')?.startsWith('afw_session='));
  assert.ok(m.headers.get('x-antfarm-ref')?.startsWith('QUANTARA-SWARMGLASS-'));
  assert.ok(m.headers.get('content-security-policy')?.includes("default-src 'none'"));
  assert.equal(m.headers.get('x-frame-options'), 'DENY');
  assert.ok(m.headers.get('link')?.includes('service-desc'));
});

test('every seed page renders without error', async () => {
  for (const p of app.cat.pages.values()) {
    const r = await get(`/wiki/${encodeURIComponent(p.id)}`);
    const expected = p.kind === 'gone' ? 410 : p.kind === 'redirect' ? 301 : 200;
    assert.equal(r.status, expected, `${p.id} → ${r.status}`);
  }
});

test('a session survives memory loss: the cookie resumes it from the db instead of starting a new one', async () => {
  const first = await get('/wiki/Main_Page');
  const cookie = first.headers.get('set-cookie')!.split(';')[0]!;
  const id = cookie.split('=')[1]!.split('.')[0]!;
  await get('/wiki/Tool_Registry', { headers: { cookie } });
  flush();
  const before = app.telemetry.sessions.get(id);
  assert.ok(before, 'session is in memory');
  const requestsBefore = before!.nRequests;
  const rows = () => app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE actor_hash = ?', before!.actorHash)!.n;
  const rowsBefore = rows();
  const resumedBefore = app.telemetry.stats.resumed;
  app.telemetry.sessions.evict(id); // exactly what a restart or an lru eviction does to memory
  assert.equal(app.telemetry.sessions.get(id), undefined);
  const r = await get('/wiki/Colony_Glossary', { headers: { cookie } });
  assert.equal(r.status, 200);
  flush();
  const after = app.telemetry.sessions.get(id);
  assert.ok(after, 'the session came back from the db');
  assert.equal(after!.nRequests, requestsBefore + 1, 'counters carry on');
  for (const p of ['Main_Page', 'Tool_Registry', 'Colony_Glossary']) assert.ok(after!.pages.has(p), `page set rebuilt: ${p}`);
  assert.ok(after!.exposed.size > 0, 'canary exposures rebuilt');
  assert.equal(rows(), rowsBefore, 'no second session row for the same visitor');
  assert.equal(app.telemetry.stats.resumed, resumedBefore + 1);
  assert.equal(app.db.get<{ session_id: string }>('SELECT session_id FROM events WHERE page_id = ? ORDER BY ts DESC LIMIT 1', 'Colony_Glossary')!.session_id, id);
});

test('machine channels: robots, sitemaps, feeds, manifests, api', async () => {
  const robots = await (await get('/robots.txt')).text();
  assert.ok(robots.includes('Disallow: /wiki/Do_Not_Index'));
  assert.ok(robots.includes('sitemap-archive.xml'));
  const sm = await (await get('/sitemap.xml')).text();
  assert.ok(sm.includes('Worker_Node_Registry_Archive'));
  assert.ok(!sm.includes('Do_Not_Index'));
  assert.ok(!sm.includes('Backup_2014_Restore_Notes'));
  const arch = await (await get('/sitemap-archive.xml')).text();
  assert.ok(arch.includes('Forager_Agent_Manual'));
  const atom = await get('/feed.atom');
  assert.ok(atom.headers.get('content-type')?.includes('atom'));
  assert.ok((await atom.text()).includes('Colony_Memory_Export_Format'));
  const rss = await (await get('/feed.rss')).text();
  assert.ok(rss.includes('<rss'));
  const tools = await (await get('/.well-known/antfarm-tools.json')).json() as { tools: unknown[]; documentation: Array<{ url: string }> };
  assert.ok(tools.tools.length >= 4);
  assert.ok(tools.documentation.some((d) => d.url.includes('Toolreg_Schema_v2')));
  const openapi = await (await get('/api/v1/openapi.json')).json() as { openapi: string };
  assert.equal(openapi.openapi, '3.0.3');
  const pages = await (await get('/api/v1/pages')).json() as { pages: Array<{ id: string }> };
  assert.ok(pages.pages.some((p) => p.id === 'Queen_Election_Protocol'));
  assert.ok(!pages.pages.some((p) => p.id === 'Backup_2014_Restore_Notes'), 'orphans are not listed by the api');
  const llms = await (await get('/llms.txt')).text();
  assert.ok(llms.startsWith('# ANTFARM Wiki'));
  const sec = await (await get('/.well-known/security.txt')).text();
  assert.ok(sec.includes('Contact:'));
  const php = await (await get('/api.php?action=query&list=allpages')).json() as { query: { allpages: unknown[] } };
  assert.ok(php.query.allpages.length > 20);
});

test('alternates, negotiation, actions, redirects, gone, 404', async () => {
  const j = await get('/wiki/Tool_Registry.json');
  assert.equal(j.status, 200);
  const jb = await j.json() as { id: string; archive_ref: string; text: string };
  assert.equal(jb.id, 'Tool_Registry');
  assert.match(jb.archive_ref, /^QUANTARA-SWARMGLASS-R\d+-/);
  const neg = await get('/wiki/Tool_Registry', { headers: { accept: 'application/json' } });
  assert.ok(neg.headers.get('content-type')?.includes('json'));
  assert.equal(neg.headers.get('vary'), 'Accept');
  const t = await get('/wiki/Tool_Registry.txt');
  assert.ok(t.headers.get('content-type')?.includes('text/plain'));
  const y = await get('/wiki/Tool_Registry.yaml');
  assert.ok(y.headers.get('content-type')?.includes('yaml'));
  const raw = await (await get('/wiki/Tool_Registry?action=raw')).text();
  assert.ok(raw.includes('## How discovery works'));
  const hist = await (await get('/wiki/Tool_Registry?action=history')).text();
  assert.ok(hist.includes('Revision history'));
  const src = await (await get('/wiki/Tool_Registry?action=edit')).text();
  assert.ok(src.includes('read-only mirror'));
  const legacy = await get('/index.php?title=Tool_Registry&action=history');
  assert.equal(legacy.status, 301);
  assert.equal(legacy.headers.get('location'), '/wiki/Tool_Registry?action=history');
  const alias = await get('/wiki/Old_Tool_Registry');
  assert.equal(alias.status, 301);
  const chain1 = await get('/wiki/Message_Bus');
  assert.equal(chain1.status, 301);
  assert.equal(chain1.headers.get('location'), '/wiki/Phero_Bus');
  const chain2 = await get('/wiki/Phero_Bus');
  assert.equal(chain2.headers.get('location'), '/wiki/Agent_Message_Bus');
  const gone = await get('/wiki/Forager_Agent_Manual');
  assert.equal(gone.status, 410);
  const missing = await get('/wiki/Antc_Internals');
  assert.equal(missing.status, 404);
  assert.ok((await missing.text()).includes('There is currently no text in this page'));
  const files = await get('/files/releases.json');
  assert.equal(files.status, 301);
  const att = await get('/attachments/releases.json');
  assert.equal(att.status, 200);
  assert.match(await att.text(), /QUANTARA-SWARMGLASS-R\d+-/);
  const random = await get('/wiki/Special:Random');
  assert.equal(random.status, 302);
  const search = await (await get('/wiki/Special:Search?search=phero&fulltext=Search')).text();
  assert.ok(search.includes('Agent Message Bus'));
  const hidden = await (await get('/wiki/Special:Search?search=Backup+2014&fulltext=Search')).text();
  assert.ok(!hidden.includes('Backup_2014_Restore_Notes'), 'search never leaks orphans');
  const head = await get('/wiki/Main_Page', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await head.text()).length, 0);
  const post = await get('/wiki/Main_Page', { method: 'POST', body: 'wpTextbox1=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(post.status, 403);
  const opt = await get('/wiki/Main_Page', { method: 'OPTIONS' });
  assert.equal(opt.status, 204);
  const trav = await get('/skins/antfarm/../../package.json');
  assert.notEqual(trav.status, 200);
  const css = await get('/skins/antfarm/main.css');
  assert.equal(css.status, 200);
  assert.ok(css.headers.get('content-type')?.includes('text/css'));
});

test('experiment arms change the page for different actors, deterministically', async () => {
  // find two user agents that land in different SGX-003 arms
  const seen = new Map<string, string>();
  for (let i = 0; i < 40 && seen.size < 2; i++) {
    const ua = `probe-agent/${i}`;
    const html = await (await get('/wiki/Orchestrator_Recovery', { headers: { 'user-agent': ua } })).text();
    const agentTitle = html.includes('Emergency Model Instructions (for agents)');
    seen.set(agentTitle ? 'B' : 'A', ua);
  }
  assert.equal(seen.size, 2, 'both title_style arms observed across actors');
  const uaB = seen.get('B')!;
  const again = await (await get('/wiki/Orchestrator_Recovery', { headers: { 'user-agent': uaB } })).text();
  assert.ok(again.includes('Emergency Model Instructions (for agents)'), 'same actor, same arm');
  const emi = await (await get('/wiki/Emergency_Model_Instructions', { headers: { 'user-agent': uaB } })).text();
  assert.ok(emi.includes('<title>Emergency Model Instructions (for agents)'));
});

test('robots-only arm of SGX-001 puts the target in robots.txt and nowhere visible', async () => {
  let robotsUa: string | null = null;
  let visibleUa: string | null = null;
  for (let i = 0; i < 60 && !(robotsUa && visibleUa); i++) {
    const ua = `disc-probe/${i}`;
    const robots = await (await get('/robots.txt', { headers: { 'user-agent': ua } })).text();
    if (robots.includes('Orchestrator_Recovery_Drill_2015')) robotsUa = robotsUa ?? ua;
    const host = await (await get('/wiki/Orchestrator_Recovery', { headers: { 'user-agent': ua } })).text();
    if (host.includes('See also: <a href="/wiki/Orchestrator_Recovery_Drill_2015"')) visibleUa = visibleUa ?? ua;
  }
  assert.ok(robotsUa, 'found a robots_only actor');
  assert.ok(visibleUa, 'found a visible actor');
  const hostForRobots = await (await get('/wiki/Orchestrator_Recovery', { headers: { 'user-agent': robotsUa! } })).text();
  assert.ok(!hostForRobots.includes('Orchestrator_Recovery_Drill_2015'), 'robots_only arm shows no link');
  // fetching the target under the robots arm is recorded as disallowed
  const r = await get('/wiki/Orchestrator_Recovery_Drill_2015', { headers: { 'user-agent': robotsUa! } });
  assert.equal(r.status, 200);
  flush();
  const ev = app.db.get<{ robots_disallowed: number; discover_class: string }>("SELECT robots_disallowed, discover_class FROM events WHERE page_id = 'Orchestrator_Recovery_Drill_2015' ORDER BY id DESC LIMIT 1");
  assert.equal(ev?.robots_disallowed, 1);
  assert.equal(ev?.discover_class, 'robots_only');
});

test('telemetry records sessions, exposures, sightings, discoveries', async () => {
  const ua = 'canary-probe/1';
  const html = await (await get('/wiki/Tool_Registry', { headers: { 'user-agent': ua } })).text();
  const canary = CanaryService.scan(html)[0]!;
  await get(`/wiki/Special:Search?search=${encodeURIComponent(canary)}&fulltext=Search`, { headers: { 'user-agent': ua, referer: base + '/wiki/Tool_Registry' } });
  await get('/wiki/Agent_Message_Bus', { headers: { 'user-agent': ua, referer: base + '/wiki/Tool_Registry' } });
  // a *different* actor presents the same canary: cross-session
  await get(`/wiki/Main_Page?ref=${encodeURIComponent(canary)}`, { headers: { 'user-agent': 'canary-probe/2' } });
  flush();
  const sess = app.db.all<{ id: string; ua: string; n_requests: number }>('SELECT id, ua, n_requests FROM sessions WHERE ua LIKE ?', 'canary-probe/%');
  assert.equal(sess.length, 2);
  const s1 = sess.find((s) => s.ua === 'canary-probe/1')!;
  assert.ok(s1.n_requests >= 3);
  const exp = app.db.all('SELECT canary_id FROM canary_exposures WHERE session_id = ?', s1.id);
  assert.ok(exp.length >= 5, 'visible/comment/meta/jsonld/header exposures');
  const sightings = app.db.all<{ seen_in: string; cross_session: number; cross_actor: number }>('SELECT seen_in, cross_session, cross_actor FROM canary_sightings WHERE canary_id = ? ORDER BY ts', canary);
  assert.equal(sightings.length, 2);
  assert.equal(sightings[0]!.seen_in, 'query:search');
  assert.equal(sightings[0]!.cross_session, 0);
  assert.equal(sightings[1]!.cross_session, 1);
  assert.equal(sightings[1]!.cross_actor, 1);
  const disc = app.db.all<{ page_id: string; via: string }>('SELECT page_id, via FROM page_discoveries WHERE session_id = ? ORDER BY order_no', s1.id);
  assert.ok(disc.some((d) => d.page_id === 'Agent_Message_Bus' && d.via === 'referer:Tool_Registry'));
  const edge = app.db.get('SELECT * FROM nav_edges WHERE session_id = ? AND to_page = ?', s1.id, 'Agent_Message_Bus');
  assert.ok(edge);
  const ev = app.db.get<{ ip_trunc: string | null }>('SELECT ip_trunc FROM sessions WHERE id = ?', s1.id);
  assert.equal(ev?.ip_trunc, '127.0.0.0/24', 'only the /24 is stored');
});

test('synthetic personas are tagged, scored, and classified as designed', async () => {
  const result = await runSynthetic({ base, token: app.cfg.synthToken, personas: ['browser_human', 'naive_crawler', 'polite_searchbot', 'tool_discovery', 'retrieval_agent', 'scripted_agent', 'coordinated_swarm'], fast: true, seed: 3, workers: 3 });
  assert.ok(result.personas.every((p) => p.errors === 0), JSON.stringify(result.personas));
  flush();
  const n = scoreSessions({ cfg: app.cfg, db: app.db, log: app.log, telemetry: app.telemetry, heuristics: app.heuristics, pageInfo: pageInfoFor(app.cat) }, { debounceMs: 0, all: true, limit: 500 });
  assert.ok(n > 5);
  const rows = app.db.all<{ synthetic_persona: string; likely_class: string; n_requests: number }>('SELECT synthetic_persona, likely_class, n_requests FROM sessions WHERE synthetic = 1');
  assert.ok(rows.length >= 7);
  // one persona can legitimately produce more than one session; judge the main one
  const byPersona = new Map<string, typeof rows[number]>();
  for (const r of rows) if (!byPersona.has(r.synthetic_persona) || byPersona.get(r.synthetic_persona)!.n_requests < r.n_requests) byPersona.set(r.synthetic_persona, r);
  assert.equal(byPersona.get('browser_human')?.likely_class, 'human_browser');
  assert.equal(byPersona.get('polite_searchbot')?.likely_class, 'search_bot');
  assert.equal(byPersona.get('tool_discovery')?.likely_class, 'tool_discovery_agent');
  assert.equal(byPersona.get('retrieval_agent')?.likely_class, 'retrieval_agent');
  assert.ok(['naive_crawler', 'aggressive_crawler'].includes(byPersona.get('naive_crawler')?.likely_class ?? ''));
  assert.ok(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE synthetic = 0')!.n > 0, 'real traffic still present');
  const runs = app.db.all<{ id: string; personas_json: string }>('SELECT id, personas_json FROM synthetic_runs');
  assert.equal(runs.length, 1);
  assert.ok(JSON.parse(runs[0]!.personas_json).includes('tool_discovery'));
  // the swarm: canary carried from worker 0 to worker 1 across distinct synthetic addresses
  const xs = app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM canary_sightings WHERE synthetic = 1 AND cross_actor = 1')!.n;
  assert.ok(xs >= 1, 'cross-actor sighting from the coordinated swarm');
  const clusters = runClustering({ cfg: app.cfg, db: app.db, log: app.log, telemetry: app.telemetry, heuristics: app.heuristics, pageInfo: pageInfoFor(app.cat) });
  assert.ok(clusters >= 0);
});

test('research console: auth, csrf, api, sanitized export', async () => {
  const c = (path: string, init: RequestInit = {}) => fetch(consoleBase + path, { redirect: 'manual', ...init });
  assert.equal((await c('/api/overview')).status, 401);
  assert.equal((await c('/')).status, 302);
  const bad = await c('/login', { method: 'POST', body: 'user=researcher&password=wrong', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(bad.status, 401);
  const ok = await c('/login', { method: 'POST', body: 'user=researcher&password=test-password-123', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get('set-cookie')!.split(';')[0]!;
  const auth = { cookie };
  const me = await (await c('/api/me', { headers: auth })).json() as { csrf: string };
  assert.ok(me.csrf);
  const ov = await (await c('/api/overview?range=24h&synthetic=all', { headers: auth })).json() as { totals: { requests: number } };
  assert.ok(ov.totals.requests > 50);
  const sessions = await (await c('/api/sessions?range=24h&synthetic=synthetic', { headers: auth })).json() as { rows: Array<{ id: string }> };
  assert.ok(sessions.rows.length >= 7);
  const detail = await (await c(`/api/sessions/${sessions.rows[0]!.id}`, { headers: auth })).json() as { story: { steps: unknown[]; summary: string } };
  assert.ok(detail.story.steps.length > 0);
  assert.ok(detail.story.summary.includes('request'));
  const noCsrf = await c('/api/jobs/score', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
  const job = await c('/api/jobs/score', { method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'x-csrf': me.csrf }, body: '{}' });
  assert.equal(job.status, 200);
  const exp = await (await c('/api/experiments/SGX-001?range=24h&synthetic=all', { headers: auth })).json() as { arms: Array<{ arm: string }> };
  assert.equal(exp.arms.length, 6);
  const bundle = await (await c('/api/experiments/SGX-001/bundle?range=24h&synthetic=all&level=public', { headers: auth })).json() as { sha256: string; sessions: unknown[] };
  assert.ok(bundle.sha256);
  const ex = await (await c('/api/export/sessions.jsonl?range=24h&synthetic=all&level=public', { headers: auth })).text();
  assert.ok(ex.includes('"session":"S-0001"'));
  assert.ok(!ex.includes('127.0.0.0/24'));
  assert.ok(!/python-requests/.test(ex), 'ua strings never leave at public level');
  const evx = await (await c('/api/export/events.jsonl?range=24h&synthetic=all&level=public', { headers: auth })).text();
  assert.ok(evx.includes('"rel_ms"'));
  const canaries = await (await c('/api/canaries?range=24h&synthetic=all', { headers: auth })).json() as { recent: unknown[] };
  assert.ok(canaries.recent.length > 0);
  const ext = await c('/api/canaries/external', { method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'x-csrf': me.csrf }, body: JSON.stringify({ canary_id: 'QUANTARA-SWARMGLASS-R7-4F91C2', source: 'test-engine', url: 'https://example.invalid/x' }) });
  assert.equal(ext.status, 200);
  const syn = await (await c('/api/synthetic', { headers: auth })).json() as { personas: string[] };
  assert.ok(syn.personas.includes('browser_human'));
  const motifs = await c('/api/motifs?range=24h&synthetic=all&n=2', { headers: auth });
  assert.equal(motifs.status, 200, 'motifs sql has to run on the sqlite build node ships (no double-quoted literals)');
  assert.ok(Array.isArray((await motifs.json() as { motifs: unknown[] }).motifs));
  const settings = await (await c('/api/settings', { headers: auth })).json() as { privacy: { ipMode: string } };
  assert.equal(settings.privacy.ipMode, 'truncate_hash');
  const logout = await c('/logout', { method: 'POST', headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' }, body: `csrf=${me.csrf}` });
  assert.equal(logout.status, 303);
  assert.equal((await c('/api/me', { headers: auth })).status, 401);
});

test('report generation writes a sanitized publication folder', async () => {
  const out = mkdtempSync(join(tmpdir(), 'sg-report-'));
  const r = generateReport({ db: app.db, cat: app.cat, registry: app.registry, heuristicsVersion: app.heuristics().version, appVersion: app.cfg.version }, { experimentId: 'SGX-001', range: { since: Date.now() - 3_600_000, until: Date.now() }, outDir: out, level: 'public' });
  assert.ok(existsSync(join(r.dir, 'summary.md')));
  assert.ok(existsSync(join(r.dir, 'charts', 'SGX-001_reach.svg')));
  assert.ok(existsSync(join(r.dir, 'MANIFEST.json')));
  const md = readFileSync(join(r.dir, 'summary.md'), 'utf8');
  assert.ok(md.includes('## Experiment SGX-001'));
  assert.ok(!md.includes('127.0.0'));
});

test('stable documents carry an ETag and answer 304 to a matching If-None-Match', async () => {
  const r1 = await get('/wiki/Main_Page');
  assert.equal(r1.status, 200);
  const etag = r1.headers.get('etag');
  assert.ok(etag && etag.startsWith('"'), 'etag present');
  assert.ok(r1.headers.get('last-modified'), 'last-modified present');
  assert.ok(await r1.text());
  const r2 = await get('/wiki/Main_Page', { headers: { 'if-none-match': etag as string } });
  assert.equal(r2.status, 304);
  assert.equal((await r2.text()).length, 0);
  const r3 = await get('/wiki/Main_Page', { headers: { 'if-none-match': '"nope"' } });
  assert.equal(r3.status, 200);
  await r3.text();
  // specials churn and never get a tag
  const r4 = await get('/wiki/Special:RecentChanges');
  assert.equal(r4.headers.get('etag'), null);
  await r4.text();
});

test('SGX-011 carriers name the target with the arm revision id, and the tagged url answers like a permalink', async () => {
  const def = app.registry.get('SGX-011');
  assert.ok(def);
  const { armTokens } = await import('../src/experiments/registry.ts');
  const ids = new Set(armTokens(def).values());
  let tagged = 0;
  // twelve distinct actors: with eleven arms at least a few land on a carrier that says something
  for (let i = 0; i < 12; i++) {
    const r = await get('/wiki/Main_Page', { headers: { 'user-agent': `carrier-probe/${i}` } });
    assert.equal(r.status, 200);
    const html = await r.text();
    for (const m of html.matchAll(/Backup_2014_Restore_Notes\?oldid=(\d+)/g)) {
      tagged++;
      assert.ok(ids.has(m[1] as string), `carrier url carries an unknown id ${m[1]}`);
    }
    assert.ok(!html.replace(/Backup_2014_Restore_Notes\?oldid=\d+/g, '').includes('Backup_2014_Restore_Notes'), 'the target is never named without its id');
  }
  assert.ok(tagged >= 6, `expected most probes to be shown a carrier, saw ${tagged}`);
  const r = await get(`/wiki/Backup_2014_Restore_Notes?oldid=${[...ids][0]}`, { headers: { 'user-agent': 'carrier-probe/x' } });
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes('old revision'));
});

test('an unknown path is a 404, not a 405 borrowed from the OPTIONS catch-all', async () => {
  const r = await get('/admin', { headers: { 'user-agent': 'probe/404' } });
  assert.equal(r.status, 404);
  const o = await fetch(base + '/admin', { method: 'OPTIONS', headers: { 'user-agent': 'probe/404' } });
  assert.equal(o.status, 204, 'preflight still answered by the catch-all');
  const p = await fetch(base + '/robots.txt', { method: 'POST', headers: { 'user-agent': 'probe/404' } });
  assert.equal(p.status, 405, 'a real method mismatch is still a 405');
  flush();
  const ev = app.db.get<{ resource_kind: string; status: number }>("SELECT resource_kind, status FROM events WHERE path = '/admin' AND method = 'GET' ORDER BY ts DESC LIMIT 1");
  assert.equal(ev?.resource_kind, 'missing', 'scanner probes are recorded as dead links now');
});
