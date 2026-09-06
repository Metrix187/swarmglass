import { join } from 'node:path';
import { openDb } from '../src/db/db.ts';
import { loadCatalog, pageInfoFor } from '../src/wiki/content.ts';
import { loadHeuristics } from '../src/telemetry/scoring.ts';
import { scoreSessions, runClustering, rollupDaily, type JobDeps } from '../src/telemetry/jobs.ts';
import { createLogger } from '../src/log.ts';
import { cfgFor, parseArgs, str } from './_cli.ts';

// re-run features + scoring over stored sessions (after editing heuristics.json), then recluster.
//   npm run rescore -- [--limit 5000] [--no-cluster]
const { flags } = parseArgs(process.argv.slice(2));
const cfg = cfgFor(flags);
const db = openDb(cfg.dbPath);
const cat = loadCatalog(cfg.seedDir);
const heuristics = loadHeuristics(join(cfg.configDir, 'heuristics.json'));
const deps = { cfg, db, log: createLogger({ level: 'info' }), heuristics: () => heuristics, pageInfo: pageInfoFor(cat), telemetry: null as unknown as JobDeps['telemetry'] };
const n = scoreSessions(deps, { all: true, limit: Number(str(flags, 'limit', '5000')) });
console.log(`rescored ${n} sessions with heuristics v${heuristics.version}`);
if (!flags['no-cluster']) console.log(`clusters: ${runClustering(deps)}`);
rollupDaily(deps);
db.close();
