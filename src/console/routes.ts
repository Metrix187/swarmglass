import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import type { Logger } from '../log.ts';
import type { Catalog } from '../wiki/content.ts';
import type { Telemetry } from '../telemetry/capture.ts';
import type { ExperimentRegistry } from '../experiments/registry.ts';
import type { Heuristics } from '../telemetry/scoring.ts';
import { scoreSessions, runClustering, rollupDaily, type JobDeps } from '../telemetry/jobs.ts';
import { purgeOlderThan } from '../telemetry/retention.ts';
import { Router, htmlRes, json, redirect, text, type Req, type Res } from '../http/server.ts';
import { consoleSecurityHeaders } from '../http/security.ts';
import { esc } from '../http/html.ts';
import { ConsoleAuth, forbidden } from './auth.ts';
import * as q from './api.ts';
import { sanitizeSession, sanitizeEvents, sanitizeSightings, assertNoLeak, type Level } from '../publish/sanitize.ts';
import { generateReport } from '../publish/report.ts';
import { bundleExperiment } from '../experiments/bundle.ts';
import { dayKey } from '../util/time.ts';

export interface ConsoleDeps {
  cfg: Config;
  db: Db;
  log: Logger;
  cat: Catalog;
  telemetry: Telemetry;
  registry: ExperimentRegistry;
  heuristics: () => Heuristics;
  reloadHeuristics: () => Heuristics;
  jobDeps: JobDeps;
  rootDir: string;
}

const NO_STORE = { noStore: true } as const;

function j(status: number, data: unknown): Res {
  const r = json(status, data);
  r.meta = NO_STORE;
  return r;
}

export function buildConsoleRouter(deps: ConsoleDeps): Router {
  const r = new Router();
  const auth = new ConsoleAuth(deps.cfg, deps.db);
  const qd: q.QueryDeps = { db: deps.db, cat: deps.cat, registry: deps.registry };
  const uiDir = join(deps.rootDir, 'src', 'console', 'ui');
  const ui = {
    html: () => readFileSync(join(uiDir, 'index.html'), 'utf8'),
    js: () => readFileSync(join(uiDir, 'app.js'), 'utf8'),
    css: () => readFileSync(join(uiDir, 'style.css'), 'utf8'),
  };
  const headers = consoleSecurityHeaders();

  // every console response carries the hardened headers; the public listener has its own set
  const wrap = (res: Res): Res => {
    res.headers = { ...headers, ...res.headers };
    res.meta = { ...(res.meta ?? {}), noStore: true };
    return res;
  };

  const gate = (req: Req): Res | null => {
    if (!auth.ipAllowed(req.clientIp)) return wrap(text(403, 'console access is restricted to allowlisted networks\n'));
    return null;
  };

  const requireAuth = (req: Req, handler: (req: Req, session: NonNullable<ReturnType<ConsoleAuth['sessionFor']>>) => Res | Promise<Res>): Res | Promise<Res> => {
    const g = gate(req);
    if (g) return g;
    const s = auth.sessionFor(req);
    if (!s) return wrap(req.path.startsWith('/api/') ? j(401, { error: 'unauthenticated' }) : redirect(302, '/login'));
    return Promise.resolve(handler(req, s)).then(wrap);
  };

  const requireCsrf = (req: Req, handler: (req: Req, session: NonNullable<ReturnType<ConsoleAuth['sessionFor']>>) => Res | Promise<Res>) =>
    requireAuth(req, (rq, s) => (auth.csrfOk(rq, s) ? handler(rq, s) : forbidden('csrf')));

  // ---- health (no auth; nothing sensitive) ----
  r.get('/healthz', () => wrap(j(200, { ok: true, version: deps.cfg.version })), 'healthz');

  // ---- login ----
  r.get('/login', (req) => {
    const g = gate(req);
    if (g) return g;
    if (auth.sessionFor(req)) return wrap(redirect(302, '/'));
    return wrap(htmlRes(200, loginPage(deps.cfg, null)));
  }, 'login');
  r.post('/login', (req) => {
    const g = gate(req);
    if (g) return g;
    if (!auth.loginAllowed(req.clientIp)) return wrap(htmlRes(429, loginPage(deps.cfg, 'Too many attempts. Wait ten minutes.'), { 'retry-after': '600' }));
    const form = new URLSearchParams(req.body?.toString('utf8') ?? '');
    const user = (form.get('user') ?? '').slice(0, 64);
    const password = (form.get('password') ?? '').slice(0, 256);
    auth.recordAttempt(req.clientIp);
    if (!auth.checkCredentials(user, password)) {
      deps.log.warn('console login failed', { ip: req.clientIp, user: user.slice(0, 16) });
      return wrap(htmlRes(401, loginPage(deps.cfg, 'Wrong username or password.')));
    }
    const { cookie } = auth.createSession(user, req.clientIp);
    deps.log.info('console login', { user });
    return wrap(redirect(303, '/', { 'set-cookie': cookie }));
  }, 'login_post');
  r.post('/logout', (req) => requireAuth(req, (rq) => {
    auth.destroy(rq);
    return redirect(303, '/login', { 'set-cookie': auth.clearCookie() });
  }), 'logout');

  // ---- ui ----
  r.get('/', (req) => requireAuth(req, () => htmlRes(200, ui.html())), 'ui');
  r.get('/ui/app.js', (req) => requireAuth(req, () => ({ status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: ui.js() })), 'ui_js');
  // the stylesheet is plain css with nothing in it worth protecting; the login page needs it before there is a session.
  // it still sits behind the ip gate like everything else on this listener.
  r.get('/ui/style.css', (req) => gate(req) ?? wrap({ status: 200, headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'private, max-age=600' }, body: ui.css() }), 'ui_css');

  // ---- api: identity + settings ----
  r.get('/api/me', (req) => requireAuth(req, (_rq, s) => j(200, { user: s.user, csrf: s.csrf, expires_at: s.expires_at })), 'me');
  r.get('/api/settings', (req) => requireAuth(req, () => {
    const h = deps.heuristics();
    const disk = deps.db.get<{ v: string }>("SELECT v FROM kv WHERE k = 'disk_guard'");
    const counts = deps.db.get<{ sessions: number; events: number; canaries: number; sightings: number }>('SELECT (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM canaries) AS canaries, (SELECT COUNT(*) FROM canary_sightings) AS sightings');
    const audit = deps.db.all('SELECT ts, user, action, detail FROM audit_log ORDER BY ts DESC LIMIT 30');
    return j(200, {
      version: deps.cfg.version,
      env: deps.cfg.env,
      seed_version: deps.cat.version,
      pages: deps.cat.pages.size,
      attachments: deps.cat.attachments.size,
      heuristics: { version: h.version, updated: h.updated, notes: h.notes, traits: Object.keys(h.traits), classes: Object.keys(h.classes) },
      privacy: deps.cfg.privacy,
      limits: deps.cfg.limits,
      public_base_url: deps.cfg.public.baseUrl,
      base_path: deps.cfg.public.basePath,
      console_ip_allowlist: deps.cfg.console.ipAllowlist,
      trusted_proxies: deps.cfg.trustedProxies,
      db: { path: deps.cfg.dbPath === ':memory:' ? ':memory:' : '(configured)', bytes: deps.db.sizeBytes(), disk: disk ? JSON.parse(disk.v) : null, counts },
      writer: { pending: deps.telemetry.writer.pending, dropped: deps.telemetry.writer.dropped, degraded: deps.telemetry.writer.degraded },
      stats: deps.telemetry.stats,
      sessions_in_memory: deps.telemetry.sessions.size(),
      live_subscribers: deps.telemetry.bus.subscribers,
      experiments: { active: deps.registry.active().map((d) => d.id), errors: deps.registry.errors },
      audit,
    });
  }), 'settings');
  r.get('/api/heuristics', (req) => requireAuth(req, () => j(200, deps.heuristics())), 'heuristics');
  r.post('/api/heuristics/reload', (req) => requireCsrf(req, (_rq, s) => {
    try {
      const h = deps.reloadHeuristics();
      auth.audit(s.user, 'heuristics.reload', `v${h.version}`);
      return j(200, { ok: true, version: h.version });
    } catch (e) {
      return j(400, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }), 'heuristics_reload');
  r.post('/api/jobs/:name', (req) => requireCsrf(req, (rq, s) => {
    const name = rq.params.name ?? '';
    let result: unknown;
    switch (name) {
      case 'score':
        result = { scored: scoreSessions(deps.jobDeps, { debounceMs: 0, limit: 500 }) };
        break;
      case 'rescore_all':
        result = { scored: scoreSessions(deps.jobDeps, { all: true, limit: 5000 }) };
        break;
      case 'cluster':
        result = { clusters: runClustering(deps.jobDeps) };
        break;
      case 'rollup':
        rollupDaily(deps.jobDeps);
        rollupDaily(deps.jobDeps, dayKey(Date.now() - 86_400_000));
        result = { ok: true };
        break;
      case 'retention':
        result = purgeOlderThan(deps.db, deps.cfg.privacy.retentionDays, deps.log);
        break;
      case 'flush':
        result = { sessions: deps.telemetry.flushSessions(), pending: deps.telemetry.writer.pending };
        deps.telemetry.writer.flush();
        break;
      default:
        return j(404, { error: 'unknown job' });
    }
    auth.audit(s.user, `job.${name}`, JSON.stringify(result).slice(0, 200));
    return j(200, { ok: true, job: name, result });
  }), 'jobs');

  // ---- api: data ----
  const synth = (rq: Req): 'real' | 'synthetic' | 'all' => {
    const v = rq.query.get('synthetic');
    return v === 'synthetic' || v === 'all' ? v : 'real';
  };
  const range = (rq: Req) => q.parseRange(rq.query.get('range'));

  r.get('/api/overview', (req) => requireAuth(req, (rq) => j(200, q.overview(qd, range(rq), synth(rq)))), 'overview');
  r.get('/api/live/tail', (req) => requireAuth(req, () => j(200, { events: deps.telemetry.bus.tail(200) })), 'live_tail');
  r.get('/api/sessions', (req) => requireAuth(req, (rq) => {
    const sort = rq.query.get('sort') ?? 'recent';
    return j(200, q.listSessions(qd, {
      range: range(rq),
      synthetic: synth(rq),
      cls: rq.query.get('class'),
      family: rq.query.get('family'),
      q: rq.query.get('q'),
      cluster: rq.query.get('cluster'),
      experiment: rq.query.get('experiment'),
      arm: rq.query.get('arm'),
      minRequests: Number(rq.query.get('min_requests') ?? 0) || 0,
      limit: Math.min(500, Number(rq.query.get('limit') ?? 100) || 100),
      offset: Number(rq.query.get('offset') ?? 0) || 0,
      sort: (['recent', 'requests', 'pages', 'confidence', 'hidden'].includes(sort) ? sort : 'recent') as 'recent',
    }));
  }), 'sessions');
  r.get('/api/sessions/:id', (req) => requireAuth(req, (rq) => {
    const d = q.sessionDetail(qd, rq.params.id ?? '');
    return d ? j(200, d) : j(404, { error: 'no such session' });
  }), 'session');
  r.get('/api/clusters', (req) => requireAuth(req, (rq) => j(200, { clusters: q.listClusters(qd, range(rq), synth(rq)) })), 'clusters');
  r.get('/api/clusters/:id', (req) => requireAuth(req, (rq) => {
    const d = q.clusterDetail(qd, rq.params.id ?? '');
    return d ? j(200, d) : j(404, { error: 'no such cluster' });
  }), 'cluster');
  r.get('/api/pages', (req) => requireAuth(req, (rq) => j(200, { pages: q.pageFunnel(qd, range(rq), synth(rq)) })), 'pages');
  r.get('/api/pages/:id/timing', (req) => requireAuth(req, (rq) => j(200, q.timeToPage(qd, rq.params.id ?? '', range(rq), synth(rq)))), 'page_timing');
  r.get('/api/discovery', (req) => requireAuth(req, (rq) => j(200, q.discoveryMatrix(qd, range(rq), synth(rq)))), 'discovery');
  r.get('/api/canaries', (req) => requireAuth(req, (rq) => j(200, q.canaryReport(qd, range(rq), synth(rq)))), 'canaries');
  r.post('/api/canaries/external', (req) => requireCsrf(req, (rq, s) => {
    let body: { canary_id?: string; source?: string; url?: string; note?: string } = {};
    try {
      body = JSON.parse(rq.body?.toString('utf8') ?? '{}') as typeof body;
    } catch {
      return j(400, { error: 'bad json' });
    }
    const out = q.recordExternalSighting(qd, { canary_id: String(body.canary_id ?? ''), source: String(body.source ?? ''), url: body.url ? String(body.url) : undefined, note: body.note ? String(body.note) : undefined });
    if (out.ok) auth.audit(s.user, 'canary.external', String(body.canary_id ?? ''));
    return j(out.ok ? 200 : 400, out);
  }), 'canary_external');
  r.get('/api/experiments', (req) => requireAuth(req, () => j(200, q.experimentList(qd))), 'experiments');
  r.get('/api/experiments/:id', (req) => requireAuth(req, (rq) => {
    const d = q.experimentDetail(qd, rq.params.id ?? '', range(rq), synth(rq));
    return d ? j(200, d) : j(404, { error: 'no such experiment' });
  }), 'experiment');
  r.get('/api/experiments/:id/bundle', (req) => requireAuth(req, (rq, s) => {
    const def = deps.registry.get(rq.params.id ?? '');
    if (!def) return j(404, { error: 'no such experiment' });
    const level: Level = rq.query.get('level') === 'internal' ? 'internal' : 'public';
    const b = bundleExperiment(deps.db, deps.cat, def, range(rq), synth(rq), level, deps.heuristics().version, deps.cfg.version);
    auth.audit(s.user, 'bundle', `${def.id} ${level}`);
    return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${def.id}-bundle-${dayKey(Date.now())}.json"` }, body: JSON.stringify(b, null, 2) };
  }), 'bundle');
  r.get('/api/motifs', (req) => requireAuth(req, (rq) => j(200, { motifs: q.motifs(qd, range(rq), synth(rq), Math.min(5, Math.max(2, Number(rq.query.get('n') ?? 3) || 3))) })), 'motifs');
  r.get('/api/anomalies', (req) => requireAuth(req, (rq) => j(200, q.anomalies(qd, range(rq), synth(rq)))), 'anomalies');
  r.get('/api/synthetic', (req) => requireAuth(req, () => j(200, q.syntheticReport(qd))), 'synthetic');
  r.get('/api/catalog', (req) => requireAuth(req, () => j(200, {
    seed_version: deps.cat.version,
    world: deps.cat.world,
    pages: [...deps.cat.pages.values()].map((p) => ({ id: p.id, title: p.title, kind: p.kind, discover: p.discover, depth: p.depth, channels: p.channels, categories: p.categories, experiment: p.experiment, alternates: p.alternates, robots_disallow: p.robotsDisallow, links: p.links, comment_links: p.commentLinks })),
    attachments: [...deps.cat.attachments.values()].map((a) => ({ name: a.name, page: a.page, discover: a.discover, channels: a.channels })),
  })), 'catalog');

  // ---- exports (sanitized) ----
  r.get('/api/export/sessions.jsonl', (req) => requireAuth(req, (rq, s) => {
    const level: Level = rq.query.get('level') === 'internal' ? 'internal' : 'public';
    const rows = q.listSessions(qd, { range: range(rq), synthetic: synth(rq), limit: 5000, offset: 0, sort: 'recent' }).rows;
    const keyed = new Map<string, string>();
    const lines = rows.map((row, i) => JSON.stringify(sanitizeSession(row, level, keyed, i)));
    if (level === 'public') for (const l of lines) assertNoLeak(l);
    auth.audit(s.user, 'export.sessions', `${level} ${rows.length}`);
    return { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': `attachment; filename="swarmglass-sessions-${level}-${dayKey(Date.now())}.jsonl"` }, body: lines.join('\n') + '\n' };
  }), 'export_sessions');
  r.get('/api/export/events.jsonl', (req) => requireAuth(req, (rq, s) => {
    const level: Level = rq.query.get('level') === 'internal' ? 'internal' : 'public';
    const rg = range(rq);
    const sy = synth(rq);
    const sf = sy === 'all' ? '' : ` AND synthetic = ${sy === 'synthetic' ? 1 : 0}`;
    const rows = deps.db.all<Record<string, unknown>>(`SELECT * FROM events WHERE ts >= ? AND ts <= ?${sf} ORDER BY ts LIMIT 200000`, rg.since, rg.until);
    const keyed = new Map<string, string>();
    const lines = sanitizeEvents(rows, level, keyed).map((e) => JSON.stringify(e));
    if (level === 'public') for (const l of lines) assertNoLeak(l);
    auth.audit(s.user, 'export.events', `${level} ${rows.length}`);
    return { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': `attachment; filename="swarmglass-events-${level}-${dayKey(Date.now())}.jsonl"` }, body: lines.join('\n') + '\n' };
  }), 'export_events');
  r.get('/api/export/sightings.jsonl', (req) => requireAuth(req, (rq, s) => {
    const level: Level = rq.query.get('level') === 'internal' ? 'internal' : 'public';
    const rg = range(rq);
    const rows = deps.db.all<Record<string, unknown>>('SELECT * FROM canary_sightings WHERE ts >= ? AND ts <= ? ORDER BY ts LIMIT 50000', rg.since, rg.until);
    const keyed = new Map<string, string>();
    const lines = sanitizeSightings(rows, level, keyed).map((e) => JSON.stringify(e));
    auth.audit(s.user, 'export.sightings', `${level} ${rows.length}`);
    return { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }, body: lines.join('\n') + '\n' };
  }), 'export_sightings');
  r.post('/api/report', (req) => requireCsrf(req, async (rq, s) => {
    let body: { experiment?: string; range?: string; out?: string } = {};
    try {
      body = JSON.parse(rq.body?.toString('utf8') ?? '{}') as typeof body;
    } catch {
      return j(400, { error: 'bad json' });
    }
    const outDir = join(deps.rootDir, 'reports');
    const result = generateReport({ db: deps.db, cat: deps.cat, registry: deps.registry, heuristicsVersion: deps.heuristics().version, appVersion: deps.cfg.version }, { experimentId: body.experiment ?? null, range: q.parseRange(body.range ?? '7d'), outDir, level: 'public' });
    auth.audit(s.user, 'report', result.dir);
    return j(200, { ok: true, ...result });
  }), 'report');

  // ---- sse live stream ----
  // the tiny router returns whole bodies; SSE needs a long-lived response, so it is
  // handled specially by the server through a marker the app checks. simplest: long-poll.
  r.get('/api/live/poll', (req) => requireAuth(req, (rq) => {
    const since = Number(rq.query.get('since') ?? 0) || 0;
    const evs = deps.telemetry.bus.tail(200).filter((e) => e.ts > since);
    return j(200, { events: evs, now: Date.now() });
  }), 'live_poll');

  return r;
}

function loginPage(cfg: Config, error: string | null): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swarmglass research console</title><link rel="stylesheet" href="/ui/style.css"></head>
<body class="login"><main class="login-card"><h1>swarmglass <span class="sub">research console</span></h1><p class="muted">Quantara · passive agent-behaviour observatory · ${esc(cfg.env)}</p>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/login"><label>User <input name="user" autocomplete="username" required autofocus></label><label>Password <input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form>
<p class="muted small">Sessions last 12 hours. This console never touches the public listener's session cookie.</p></main></body></html>`;
}
