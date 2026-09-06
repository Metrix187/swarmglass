import { Db, migrate } from '../src/db/db.ts';
import { cfgFor, parseArgs } from './_cli.ts';

// apply pending migrations. safe to run any number of times.
const { flags } = parseArgs(process.argv.slice(2));
const cfg = cfgFor(flags);
const db = new Db(cfg.dbPath);
const ran = migrate(db);
console.log(ran.length ? `applied: ${ran.join(', ')}` : 'nothing to apply');
console.log(`db: ${cfg.dbPath} (${(db.sizeBytes() / 1048576).toFixed(2)} MB)`);
db.close();
