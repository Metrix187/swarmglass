import { readFileSync } from 'node:fs';
import { openDb } from '../src/db/db.ts';
import { CanaryService } from '../src/telemetry/canary.ts';
import { loadCatalog } from '../src/wiki/content.ts';
import { recordExternalSighting } from '../src/console/api.ts';
import { ExperimentRegistry } from '../src/experiments/registry.ts';
import { join } from 'node:path';
import { cfgFor, parseArgs, str, usage } from './_cli.ts';

// canary utilities:
//   canary lookup QUANTARA-SWARMGLASS-R7-4F91C2      what is it, where was it placed, who saw it
//   canary scan <file>                              find canaries in any text (a model transcript, a search dump)
//   canary external --id ID --source google --url https://… --note "…"   record a sighting in the wild
//   canary list [--page Tool_Registry]              issued canaries
//   canary predict <page> [placement]               what the route-scoped canary for a page *would* be
const { flags, positional } = parseArgs(process.argv.slice(2));
const cmd = positional[0];
if (!cmd) usage(['usage: canary lookup ID | scan FILE | external --id ID --source S [--url U] [--note N] | list [--page P] | predict PAGE [PLACEMENT]']);
const cfg = cfgFor(flags);
const db = openDb(cfg.dbPath);
const cat = loadCatalog(cfg.seedDir);
const svc = new CanaryService({ secret: cfg.secretKey, seedVersion: cat.version, routeNo: (id) => cat.routeNo.get(id) ?? 0, db });

switch (cmd) {
  case 'lookup': {
    const id = (positional[1] ?? '').toUpperCase();
    const c = svc.lookup(id);
    if (!c) {
      console.log('unknown canary (never issued by this instance, or a different seed/secret)');
      break;
    }
    console.log(c);
    console.log('exposures:', db.all('SELECT session_id, actor_hash, first_at, placement FROM canary_exposures WHERE canary_id = ? ORDER BY first_at LIMIT 50', id));
    console.log('sightings:', db.all('SELECT ts, session_id, seen_in, cross_session, cross_actor, external, detail FROM canary_sightings WHERE canary_id = ? ORDER BY ts LIMIT 50', id));
    break;
  }
  case 'scan': {
    const text = readFileSync(positional[1] ?? '', 'utf8');
    const found = CanaryService.scan(text);
    for (const id of found) {
      const c = svc.lookup(id);
      console.log(`${id}  ${c ? `${c.scope}/${c.placement} page=${c.pageId ?? '-'} exp=${c.experimentId ?? '-'}` : '(unknown to this instance)'}`);
    }
    if (!found.length) console.log('no canaries found');
    break;
  }
  case 'external': {
    const out = recordExternalSighting({ db, cat, registry: ExperimentRegistry.load(join(cfg.configDir, 'experiments')) }, { canary_id: str(flags, 'id', ''), source: str(flags, 'source', 'manual'), url: str(flags, 'url', ''), note: str(flags, 'note', '') });
    console.log(out);
    break;
  }
  case 'list': {
    const page = str(flags, 'page', '');
    const rows = page ? db.all('SELECT id, scope, placement, issue_count, first_issued_at, last_issued_at FROM canaries WHERE page_id = ? ORDER BY placement', page) : db.all('SELECT id, scope, placement, page_id, issue_count FROM canaries ORDER BY issue_count DESC LIMIT 100');
    console.table(rows);
    break;
  }
  case 'predict': {
    const page = positional[1] ?? 'Main_Page';
    const placement = (positional[2] ?? 'visible') as never;
    console.log(svc.route(page, placement).id);
    break;
  }
  default:
    usage([`unknown command ${cmd}`]);
}
db.close();
