import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import type { Server } from 'node:http';
import { loadConfig, type Config } from './config.ts';
import { createLogger, silentLogger, type Logger } from './log.ts';
import { openDb, type Db } from './db/db.ts';
import { BufferedWriter } from './db/writer.ts';
import { loadCatalog, pageInfoFor, type Catalog } from './wiki/content.ts';
import { CanaryService } from './telemetry/canary.ts';
import { Telemetry } from './telemetry/capture.ts';
import { ExperimentRegistry } from './experiments/registry.ts';
import { buildWikiRouter, notFound } from './wiki/routes.ts';
import { createHttpServer, type Router } from './http/server.ts';
import { publicSecurityHeaders } from './http/security.ts';
import { inAnyCidr } from './util/ip.ts';
import { loadHeuristics, type Heuristics } from './telemetry/scoring.ts';
import { startScheduler, type JobDeps, type Scheduler } from './telemetry/jobs.ts';
import { buildConsoleRouter } from './console/routes.ts';
import { shortHash } from './util/hash.ts';
import type { WikiDeps } from './wiki/context.ts';

// wires everything together. main.ts calls startApp(); tests call it with an in-memory config.

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');

export interface App {
  cfg: Config;
  db: Db;
  log: Logger;
  cat: Catalog;
  telemetry: Telemetry;
  registry: ExperimentRegistry;
  heuristics: () => Heuristics;
  wikiDeps: WikiDeps;
  publicServer: Server;
  consoleServer: Server;
  scheduler: Scheduler | null;
  publicPort: number;
  consolePort: number;
  close(): Promise<void>;
}

export interface StartOpts {
  cfg?: Config;
  log?: Logger;
  scheduler?: boolean;
  listen?: boolean; // false: build but do not listen (unit tests)
}

export async function startApp(opts: StartOpts = {}): Promise<App> {
  const cfg = opts.cfg ?? loadConfig(ROOT);
  const log =
    opts.log ??
    (cfg.dbPath === ':memory:' ? silentLogger : createLogger({ level: cfg.logLevel, dir: cfg.logDir, file: 'swarmglass.log', maxMb: cfg.limits.maxLogMb, base: { app: 'swarmglass', v: cfg.version } }));

  const db = openDb(cfg.dbPath);
  const writer = new BufferedWriter(db, log);
  const cat = loadCatalog(cfg.seedDir);
  const registry = ExperimentRegistry.load(join(cfg.configDir, 'experiments'));
  for (const e of registry.errors) log.warn('experiment definition problem', { problem: e });
  const heuristicsPath = join(cfg.configDir, 'heuristics.json');
  let heuristics = loadHeuristics(heuristicsPath);
  const reloadHeuristics = () => {
    heuristics = loadHeuristics(heuristicsPath);
    return heuristics;
  };

  const canaries = new CanaryService({ secret: cfg.secretKey, seedVersion: cat.version, db, writer, routeNo: (id) => cat.routeNo.get(id) ?? 0 });
  const telemetry = new Telemetry({ cfg, db, writer, log, canaries });
  const assetsDir = join(ROOT, 'assets');
  const wikiDeps: WikiDeps = { cfg, cat, canaries, registry, assetsDir, log, assetVersion: shortHash(cat.version + cfg.version, 6) };
  const isTrusted = (ip: string) => inAnyCidr(cfg.trustedProxies, ip);

  // record active experiment definitions so results stay reproducible
  for (const d of registry.active()) {
    db.run(
      'INSERT OR IGNORE INTO experiment_runs (experiment_id, version, activated_at, definition_json, seed_version, heuristics_version) VALUES (?, ?, ?, ?, ?, ?)',
      d.id,
      d.version,
      Date.now(),
      JSON.stringify(d),
      cat.version,
      heuristics.version,
    );
  }

  // ---- public honeypot ----
  const wikiRouter: Router = buildWikiRouter(wikiDeps);
  const publicServer = createHttpServer(wikiRouter, {
    basePath: cfg.public.basePath,
    trustProxy: cfg.trustProxy,
    trustedProxies: cfg.trustedProxies,
    isTrusted,
    maxBodyBytes: cfg.limits.maxBodyBytes,
    log,
    defaultHeaders: publicSecurityHeaders(),
    serverHeader: 'Apache/2.2.22 (Debian)',
    gate: (req) => {
      // optional console mount on the public listener (discouraged; documented)
      if (cfg.console.publicMount && req.path.startsWith(cfg.console.publicMount)) return null;
      return telemetry.gate(req);
    },
    onResponse: (req, res, latency) => {
      if (cfg.console.publicMount && req.path.startsWith(cfg.console.publicMount)) return;
      telemetry.onResponse(req, res, latency);
    },
    notFound: (req) => {
      if (cfg.console.publicMount && req.path.startsWith(cfg.console.publicMount)) {
        return consoleRouter.match(req.method, req.path.slice(cfg.console.publicMount.length) || '/') ? consoleFallback(req) : { status: 404, headers: {}, body: 'not found' };
      }
      return notFound(wikiDeps, req);
    },
  });

  // ---- research console ----
  const jobDeps: JobDeps = { cfg, db, log, telemetry, heuristics: () => heuristics, pageInfo: pageInfoFor(cat) };
  const consoleRouter = buildConsoleRouter({ cfg, db, log, cat, telemetry, registry, heuristics: () => heuristics, reloadHeuristics, jobDeps, rootDir: ROOT });
  const consoleFallback = async (req: import('./http/server.ts').Req) => {
    const m = consoleRouter.match(req.method, req.path.slice(cfg.console.publicMount.length) || '/');
    if (!m || 'methodMismatch' in m) return { status: 404, headers: {}, body: 'not found' };
    req.params = m.params;
    return m.route.handler(req);
  };
  const consoleServer = createHttpServer(consoleRouter, {
    basePath: '',
    trustProxy: cfg.trustProxy,
    trustedProxies: cfg.trustedProxies,
    isTrusted,
    maxBodyBytes: 1024 * 1024,
    log: log.child({ side: 'console' }),
    defaultHeaders: {},
    notFound: () => ({ status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'not found', meta: { noStore: true } }),
  });

  let publicPort = cfg.public.port;
  let consolePort = cfg.console.port;
  if (opts.listen !== false) {
    if (cfg.public.port === 0) publicPort = await freePort();
    if (cfg.console.port === 0) consolePort = await freePort();
    await listen(publicServer, cfg.public.host, publicPort);
    await listen(consoleServer, cfg.console.host, consolePort);
    log.info('swarmglass listening', { public: `${cfg.public.host}:${publicPort}${cfg.public.basePath}`, console: `${cfg.console.host}:${consolePort}`, env: cfg.env, seed: cat.version, pages: cat.pages.size, experiments: registry.active().map((d) => d.id) });
  }

  const scheduler = opts.scheduler === false ? null : startScheduler(jobDeps);

  const app: App = {
    cfg,
    db,
    log,
    cat,
    telemetry,
    registry,
    heuristics: () => heuristics,
    wikiDeps,
    publicServer,
    consoleServer,
    scheduler,
    publicPort,
    consolePort,
    async close() {
      scheduler?.stop();
      await Promise.all([closeServer(publicServer), closeServer(consoleServer)]);
      telemetry.flushSessions();
      writer.close();
      db.checkpoint();
      db.close();
      log.close();
    },
  };
  return app;
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}
