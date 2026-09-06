import { join } from 'node:path';
import { openDb } from '../src/db/db.ts';
import { loadCatalog } from '../src/wiki/content.ts';
import { ExperimentRegistry } from '../src/experiments/registry.ts';
import { loadHeuristics } from '../src/telemetry/scoring.ts';
import { generateReport } from '../src/publish/report.ts';
import { parseRange } from '../src/console/api.ts';
import { cfgFor, parseArgs, str } from './_cli.ts';
import { ROOT } from '../src/app.ts';

// npm run report -- [--experiment SGX-001] [--range 7d] [--out reports] [--level public|internal]
const { flags } = parseArgs(process.argv.slice(2));
const cfg = cfgFor(flags);
const db = openDb(cfg.dbPath);
const cat = loadCatalog(cfg.seedDir);
const registry = ExperimentRegistry.load(join(cfg.configDir, 'experiments'));
const heuristics = loadHeuristics(join(cfg.configDir, 'heuristics.json'));
const out = generateReport(
  { db, cat, registry, heuristicsVersion: heuristics.version, appVersion: cfg.version },
  { experimentId: typeof flags.experiment === 'string' ? flags.experiment : null, range: parseRange(str(flags, 'range', '7d')), outDir: str(flags, 'out', join(ROOT, 'reports')), level: str(flags, 'level', 'public') === 'internal' ? 'internal' : 'public' },
);
console.log(`report written to ${out.dir}`);
for (const f of out.files) console.log('  ' + f);
db.close();
