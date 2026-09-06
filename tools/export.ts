import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openDb } from '../src/db/db.ts';
import { sanitizeSession, sanitizeEvents, sanitizeSightings, assertNoLeak } from '../src/publish/sanitize.ts';
import { parseRange } from '../src/console/api.ts';
import { cfgFor, parseArgs, str } from './_cli.ts';
import { ROOT } from '../src/app.ts';
import { dayKey } from '../src/util/time.ts';

// npm run export -- [--range 30d] [--level public|internal] [--out exports] [--synthetic real|synthetic|all]
// writes a dataset folder: sessions.jsonl, events.jsonl, sightings.jsonl, README.md, SHA256SUMS
const { flags } = parseArgs(process.argv.slice(2));
const cfg = cfgFor(flags);
const level = str(flags, 'level', 'public') === 'internal' ? 'internal' : 'public';
const synthetic = str(flags, 'synthetic', 'real');
const range = parseRange(str(flags, 'range', '30d'));
const db = openDb(cfg.dbPath);
const sf = synthetic === 'all' ? '' : ` AND synthetic = ${synthetic === 'synthetic' ? 1 : 0}`;
const name = `swarmglass-dataset-${level}-${dayKey(Date.now())}`;
const dir = join(str(flags, 'out', join(ROOT, 'exports')), name);
mkdirSync(dir, { recursive: true });
const keyed = new Map<string, string>();

const sessions = db.all<Record<string, unknown>>(`SELECT * FROM sessions WHERE started_at >= ? AND started_at <= ?${sf} ORDER BY started_at`, range.since, range.until);
const sessionLines = sessions.map((s, i) => {
  const d = { ...s };
  for (const k of ['cohorts_json', 'features_json', 'scores_json']) {
    if (typeof d[k] === 'string') d[k.replace('_json', '')] = JSON.parse(d[k] as string);
    delete d[k];
  }
  return JSON.stringify(sanitizeSession(d, level, keyed, i));
});
const events = db.all<Record<string, unknown>>(`SELECT * FROM events WHERE ts >= ? AND ts <= ?${sf} ORDER BY ts`, range.since, range.until);
const eventLines = sanitizeEvents(events, level, keyed).map((e) => JSON.stringify(e));
const sightings = db.all<Record<string, unknown>>(`SELECT * FROM canary_sightings WHERE ts >= ? AND ts <= ?${sf} ORDER BY ts`, range.since, range.until);
const sightingLines = sanitizeSightings(sightings, level, keyed).map((e) => JSON.stringify(e));

const files: Record<string, string> = {
  'sessions.jsonl': sessionLines.join('\n') + '\n',
  'events.jsonl': eventLines.join('\n') + '\n',
  'sightings.jsonl': sightingLines.join('\n') + '\n',
  'README.md': `# ${name}

Swarmglass dataset export. Level: **${level}**. Traffic: ${synthetic}. Window: ${new Date(range.since).toISOString()} → ${new Date(range.until).toISOString()}.
Generated ${new Date().toISOString()} by Swarmglass ${cfg.version}.

Files:
- sessions.jsonl — one session per line (${sessions.length})
- events.jsonl — one request per line (${events.length}); \`session\` joins to sessions
- sightings.jsonl — canary sightings (${sightings.length})

Session and actor ids are re-keyed per export (S-0001, A-0001…) and do not match ids in any other export.
${level === 'public' ? 'Public level: no network prefixes, no user-agent strings (family only), hour-resolution timestamps, no external referer hosts.' : 'INTERNAL level: contains truncated network prefixes and user-agent strings. Do not publish.'}
See docs/DATA_DICTIONARY.md for every field.
`,
};
if (level === 'public') for (const [f, body] of Object.entries(files)) if (f !== 'README.md') assertNoLeak(body);
const sums: string[] = [];
for (const [f, body] of Object.entries(files)) {
  writeFileSync(join(dir, f), body);
  sums.push(`${createHash('sha256').update(body).digest('hex')}  ${f}`);
}
writeFileSync(join(dir, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(`exported ${sessions.length} sessions, ${events.length} events, ${sightings.length} sightings → ${dir}`);
db.close();
