import { runSynthetic } from '../src/synth/run.ts';
import { PERSONAS } from '../src/synth/personas.ts';
import { cfgFor, parseArgs, str, usage } from './_cli.ts';

// drive synthetic personas at a running instance.
//   npm run synth -- --base http://127.0.0.1:8080 --personas all
//   npm run synth -- --personas browser_human,naive_crawler --fast
// token defaults to SWARMGLASS_SYNTH_TOKEN from .env.

const { flags } = parseArgs(process.argv.slice(2));
if (flags.help) usage(['usage: synth [--base URL] [--token T] [--personas a,b|all] [--workers N] [--seed N] [--fast] [--concurrent] [--list]']);
if (flags.list) {
  for (const p of PERSONAS) console.log(`${p.name.padEnd(20)} expects ${p.expected.padEnd(22)} ${p.description}`);
  process.exit(0);
}
const cfg = cfgFor(flags);
const base = str(flags, 'base', `http://127.0.0.1:${cfg.public.port}${cfg.public.basePath}`);
const token = str(flags, 'token', cfg.synthToken);
if (!token) usage(['no synth token: set SWARMGLASS_SYNTH_TOKEN or pass --token']);
const personas = str(flags, 'personas', 'all').split(',').map((s) => s.trim()).filter(Boolean);
const result = await runSynthetic({ base, token, personas, workers: Number(str(flags, 'workers', '4')), seed: Number(str(flags, 'seed', '1')), fast: Boolean(flags.fast), concurrentPersonas: Boolean(flags.concurrent), log: (m) => console.log('  ' + m) });
console.log(`run ${result.run}`);
for (const p of result.personas) console.log(`  ${p.name.padEnd(20)} ${String(p.requests).padStart(5)} requests  ${String(p.errors).padStart(3)} errors  ${p.ms} ms`);
console.log('sessions are scored ~30s after their last request; open the console → synthetic to see the confusion matrix.');
