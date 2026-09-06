import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Row = Record<string, unknown>;
export type Param = string | number | bigint | null | Uint8Array;

// node:sqlite refuses booleans and undefined, so everything funnels through here
export function bind(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

export class Db {
  readonly raw: DatabaseSync;
  readonly path: string;
  private cache = new Map<string, StatementSync>();

  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA synchronous = NORMAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.raw.exec('PRAGMA temp_store = MEMORY');
  }

  stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastId: number } {
    const r = this.stmt(sql).run(...params.map(bind));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.stmt(sql).get(...params.map(bind)) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.stmt(sql).all(...params.map(bind)) as T[];
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      throw e;
    }
  }

  sizeBytes(): number {
    if (this.path === ':memory:') return 0;
    try {
      let total = statSync(this.path).size;
      for (const suffix of ['-wal', '-shm']) {
        try {
          total += statSync(this.path + suffix).size;
        } catch {
          // no wal yet
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  checkpoint(): void {
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // busy; next time
    }
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}

// ---- migrations: plain .sql files, applied in name order, tracked in schema_migrations ----

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, 'migrations');

export function migrate(db: Db, dir = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(db.all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', f, Date.now());
    });
    ran.push(f);
  }
  return ran;
}

export function openDb(path: string): Db {
  const db = new Db(path);
  migrate(db);
  return db;
}
