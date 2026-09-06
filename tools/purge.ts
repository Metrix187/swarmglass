import { openDb } from '../src/db/db.ts';
import { purgeOlderThan } from '../src/telemetry/retention.ts';
import { createLogger } from '../src/log.ts';
import { cfgFor, parseArgs, str } from './_cli.ts';

// npm run purge -- [--days 90] [--vacuum]
const { flags } = parseArgs(process.argv.slice(2));
const cfg = cfgFor(flags);
const db = openDb(cfg.dbPath);
const log = createLogger({ level: 'info' });
const days = Number(str(flags, 'days', String(cfg.privacy.retentionDays)));
const out = purgeOlderThan(db, days, log);
console.log(`purged rows older than ${days} days:`, out);
if (flags.vacuum) {
  db.checkpoint();
  db.exec('VACUUM');
  console.log(`vacuumed; db now ${(db.sizeBytes() / 1048576).toFixed(2)} MB`);
}
db.close();
