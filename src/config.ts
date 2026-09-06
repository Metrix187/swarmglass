import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type IpMode = 'truncate' | 'hash' | 'truncate_hash' | 'none';
export type HeaderCapture = 'allowlist' | 'names_only';
export type QueryCapture = 'sanitized' | 'none';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  env: 'production' | 'development';
  isProd: boolean;
  dataDir: string;
  dbPath: string;
  logDir: string;
  seedDir: string;
  configDir: string;
  public: {
    host: string;
    port: number;
    baseUrl: string;
    basePath: string; // "" or "/swarmglass"
  };
  console: {
    host: string;
    port: number;
    baseUrl: string;
    user: string;
    passwordHash: string; // scrypt "$scrypt$N$r$p$salt$hash"
    devPassword: string;
    ipAllowlist: string[];
    publicMount: string; // "" or "/__quantara/research"
  };
  secretKey: string;
  synthToken: string;
  trustProxy: boolean;
  trustedProxies: string[];
  privacy: {
    ipMode: IpMode;
    ipSaltRotationDays: number;
    retentionDays: number;
    headerCapture: HeaderCapture;
    queryCapture: QueryCapture;
  };
  limits: {
    rateRps: number;
    rateBurst: number;
    maxBodyBytes: number;
    maxDbMb: number;
    maxLogMb: number;
  };
  logLevel: LogLevel;
  contactEmail: string;
  version: string;
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1);
    // strip trailing comments on unquoted values
    const hash = val.indexOf(' #');
    if (hash >= 0 && !val.trim().startsWith('"') && !val.trim().startsWith("'")) val = val.slice(0, hash);
    val = val.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function env(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

function envInt(name: string, def: number): number {
  const v = Number(env(name, String(def)));
  if (!Number.isFinite(v)) throw new Error(`${name} must be a number`);
  return v;
}

function envBool(name: string, def: boolean): boolean {
  const v = env(name, def ? 'true' : 'false').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function envList(name: string, def: string): string[] {
  return env(name, def)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function oneOf<T extends string>(name: string, def: T, allowed: readonly T[]): T {
  const v = env(name, def) as T;
  if (!allowed.includes(v)) throw new Error(`${name} must be one of ${allowed.join(', ')}`);
  return v;
}

function normalizeBasePath(p: string): string {
  if (!p || p === '/') return '';
  let out = p.startsWith('/') ? p : '/' + p;
  out = out.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9_\-/]*$/.test(out)) throw new Error(`invalid base path: ${p}`);
  return out;
}

function readVersion(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function loadConfig(root = process.cwd(), opts: { dotenv?: boolean } = {}): Config {
  if (opts.dotenv !== false) loadDotEnv(resolve(root, '.env'));

  const envName = oneOf('SWARMGLASS_ENV', 'development', ['production', 'development'] as const);
  const isProd = envName === 'production';
  const dataDir = resolve(root, env('SWARMGLASS_DATA_DIR', './data'));

  const secretKey = env('SWARMGLASS_SECRET_KEY', '');
  const passwordHash = env('SWARMGLASS_CONSOLE_PASSWORD_HASH', '');
  const devPassword = env('SWARMGLASS_CONSOLE_PASSWORD', '');

  if (isProd) {
    if (secretKey.length < 32) throw new Error('SWARMGLASS_SECRET_KEY must be at least 32 characters in production');
    if (!passwordHash.startsWith('$scrypt$')) throw new Error('SWARMGLASS_CONSOLE_PASSWORD_HASH (scrypt) is required in production — run `npm run hash-password`');
  }

  const cfg: Config = {
    env: envName,
    isProd,
    dataDir,
    dbPath: resolve(dataDir, env('SWARMGLASS_DB_FILE', 'swarmglass.db')),
    logDir: resolve(dataDir, 'logs'),
    seedDir: resolve(root, env('SWARMGLASS_SEED_DIR', './seed')),
    configDir: resolve(root, env('SWARMGLASS_CONFIG_DIR', './config')),
    public: {
      host: env('SWARMGLASS_PUBLIC_HOST', '0.0.0.0'),
      port: envInt('SWARMGLASS_PUBLIC_PORT', 8080),
      baseUrl: env('SWARMGLASS_PUBLIC_BASE_URL', 'http://localhost:8080').replace(/\/+$/, ''),
      basePath: normalizeBasePath(env('SWARMGLASS_BASE_PATH', '')),
    },
    console: {
      host: env('SWARMGLASS_CONSOLE_HOST', '127.0.0.1'),
      port: envInt('SWARMGLASS_CONSOLE_PORT', 8081),
      baseUrl: env('SWARMGLASS_CONSOLE_BASE_URL', 'http://localhost:8081').replace(/\/+$/, ''),
      user: env('SWARMGLASS_CONSOLE_USER', 'researcher'),
      passwordHash,
      devPassword: isProd ? '' : devPassword || 'swarmglass-dev',
      ipAllowlist: envList('SWARMGLASS_CONSOLE_IP_ALLOWLIST', ''),
      publicMount: normalizeBasePath(env('SWARMGLASS_CONSOLE_PUBLIC_MOUNT', '')),
    },
    secretKey: secretKey || 'dev-only-secret-key-do-not-use-in-production',
    synthToken: env('SWARMGLASS_SYNTH_TOKEN', isProd ? '' : 'dev-synth-token'),
    trustProxy: envBool('SWARMGLASS_TRUST_PROXY', true),
    trustedProxies: envList('SWARMGLASS_TRUSTED_PROXIES', '127.0.0.1/32,::1/128,172.16.0.0/12,10.0.0.0/8'),
    privacy: {
      ipMode: oneOf('SWARMGLASS_PRIVACY_IP_MODE', 'truncate_hash', ['truncate', 'hash', 'truncate_hash', 'none'] as const),
      ipSaltRotationDays: envInt('SWARMGLASS_IP_SALT_ROTATION_DAYS', 1),
      retentionDays: envInt('SWARMGLASS_RETENTION_DAYS', 90),
      headerCapture: oneOf('SWARMGLASS_HEADER_CAPTURE', 'allowlist', ['allowlist', 'names_only'] as const),
      queryCapture: oneOf('SWARMGLASS_STORE_QUERY', 'sanitized', ['sanitized', 'none'] as const),
    },
    limits: {
      rateRps: envInt('SWARMGLASS_RATE_LIMIT_RPS', 30),
      rateBurst: envInt('SWARMGLASS_RATE_LIMIT_BURST', 120),
      maxBodyBytes: envInt('SWARMGLASS_MAX_BODY_BYTES', 65536),
      maxDbMb: envInt('SWARMGLASS_MAX_DB_MB', 2048),
      maxLogMb: envInt('SWARMGLASS_MAX_LOG_MB', 200),
    },
    logLevel: oneOf('SWARMGLASS_LOG_LEVEL', 'info', ['debug', 'info', 'warn', 'error'] as const),
    contactEmail: env('SWARMGLASS_CONTACT_EMAIL', ''),
    version: readVersion(root),
  };

  if (cfg.console.publicMount && !cfg.console.publicMount.startsWith('/__')) {
    throw new Error('SWARMGLASS_CONSOLE_PUBLIC_MOUNT must start with /__ so it can never collide with wiki content');
  }
  return cfg;
}

// a config for tests: in-memory db, no dotenv, dev auth
export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig(process.cwd(), { dotenv: false });
  return {
    ...base,
    env: 'development',
    isProd: false,
    dbPath: ':memory:',
    synthToken: 'test-synth-token',
    secretKey: 'test-secret-key-test-secret-key-test-secret-key',
    ...overrides,
  };
}
