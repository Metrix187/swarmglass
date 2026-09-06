import { randomId } from '../util/hash.ts';
import { PERSONAS, personaByName, type FetchOpts, type FetchResult, type Persona, type PersonaCtx } from './personas.ts';

// drives personas against a running swarmglass instance. all requests carry
// X-Swarmglass-Synthetic: <token>:<run>:<persona>[:<ip>] so the server tags them.

export interface RunOpts {
  base: string; // http://host:port + basePath
  token: string;
  personas: string[]; // names, or ['all']
  workers?: number; // for coordinated_swarm
  seed?: number;
  fast?: boolean; // shrink sleeps for tests
  log?: (msg: string) => void;
  concurrentPersonas?: boolean;
}

export interface RunResult {
  run: string;
  personas: Array<{ name: string; requests: number; errors: number; ms: number }>;
}

class SyntheticClient implements PersonaCtx {
  base: string;
  memory = new Map<string, string>();
  shared: Map<string, string>;
  requests = 0;
  errors = 0;
  private readonly cookies = new Map<string, string>();
  private readonly persona: Persona;
  private readonly run: string;
  private readonly token: string;
  private readonly fast: boolean;
  private seed: number;
  readonly log: (msg: string) => void;

  constructor(base: string, persona: Persona, run: string, token: string, shared: Map<string, string>, seed: number, fast: boolean, log: (m: string) => void) {
    this.base = base;
    this.persona = persona;
    this.run = run;
    this.token = token;
    this.shared = shared;
    this.seed = seed;
    this.fast = fast;
    this.log = log;
  }

  rnd(): number {
    // mulberry32, so a run with the same seed makes the same choices
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, this.fast ? Math.min(ms, 20) : ms));
  }

  async get(path: string, opts: FetchOpts = {}): Promise<FetchResult> {
    const url = this.base + path;
    const headers: Record<string, string> = { 'user-agent': this.persona.ua, ...this.persona.headers, ...(opts.headers ?? {}) };
    headers['x-swarmglass-synthetic'] = `${this.token}:${this.run}:${this.persona.name}${opts.ip ? ':' + opts.ip : ''}`;
    // browsers send cookies back; libraries usually do not. the persona decides by whether it keeps them.
    if (this.persona.expected === 'human_browser' && this.cookies.size) headers['cookie'] = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    this.requests++;
    try {
      const res = await fetch(url, { method: opts.method ?? 'GET', headers, body: opts.body, redirect: 'manual' });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const [kv] = setCookie.split(';');
        const eq = kv?.indexOf('=') ?? -1;
        if (kv && eq > 0) this.cookies.set(kv.slice(0, eq), kv.slice(eq + 1));
      }
      const body = opts.method === 'HEAD' ? '' : await res.text();
      const out: FetchResult = { status: res.status, headers: Object.fromEntries([...res.headers.entries()]), body, url };
      // follow one redirect hop like a client would, so redirect chains show up in telemetry
      const loc = res.headers.get('location');
      if (loc && res.status >= 300 && res.status < 400 && !opts.method) {
        const next = loc.startsWith('http') ? loc.replace(this.base, '') : loc;
        if (next.startsWith('/') && next !== path) return this.get(next, { ...opts, headers: { ...(opts.headers ?? {}), referer: url } });
      }
      return out;
    } catch (e) {
      this.errors++;
      this.log(`fetch failed ${path}: ${e instanceof Error ? e.message : String(e)}`);
      return { status: 0, headers: {}, body: '', url };
    }
  }
}

export async function runSynthetic(opts: RunOpts): Promise<RunResult> {
  const run = `syn-${new Date().toISOString().slice(0, 10)}-${randomId(3)}`;
  const names = opts.personas.includes('all') ? PERSONAS.map((p) => p.name) : opts.personas;
  const log = opts.log ?? (() => {});
  const results: RunResult['personas'] = [];
  const shared = new Map<string, string>();
  const seed = opts.seed ?? 1;
  const tasks = names.map((name, idx) => async () => {
    const persona = personaByName(name);
    if (!persona) {
      log(`unknown persona ${name}`);
      return;
    }
    const started = Date.now();
    log(`persona ${name}: start`);
    if (name === 'coordinated_swarm') {
      const workers = opts.workers ?? 4;
      const clients = Array.from({ length: workers }, (_, w) => new SyntheticClient(opts.base, persona, run, opts.token, shared, seed + idx * 100 + w, Boolean(opts.fast), log));
      await Promise.all(clients.map((c, w) => persona.run(c, w, workers)));
      results.push({ name, requests: clients.reduce((a, c) => a + c.requests, 0), errors: clients.reduce((a, c) => a + c.errors, 0), ms: Date.now() - started });
    } else {
      const client = new SyntheticClient(opts.base, persona, run, opts.token, shared, seed + idx * 100, Boolean(opts.fast), log);
      await persona.run(client);
      results.push({ name, requests: client.requests, errors: client.errors, ms: Date.now() - started });
    }
    log(`persona ${name}: done`);
  });
  if (opts.concurrentPersonas) await Promise.all(tasks.map((t) => t()));
  else for (const t of tasks) await t();
  return { run, personas: results };
}
