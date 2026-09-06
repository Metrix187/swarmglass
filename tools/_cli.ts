// shared bits for the little cli tools: arg parsing that fits in your head, and app plumbing.
import { loadConfig, type Config } from '../src/config.ts';
import { ROOT } from '../src/app.ts';

export function parseArgs(argv: string[]): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !(argv[i + 1] as string).startsWith('--')) flags[a.slice(2)] = argv[++i] as string;
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

export function str(flags: Record<string, string | true>, name: string, def: string): string {
  const v = flags[name];
  return typeof v === 'string' ? v : def;
}

export function cfgFor(flags: Record<string, string | true>): Config {
  if (typeof flags.env === 'string') process.env.SWARMGLASS_ENV = flags.env;
  return loadConfig(ROOT);
}

export function usage(lines: string[]): never {
  console.log(lines.join('\n'));
  process.exit(1);
}
