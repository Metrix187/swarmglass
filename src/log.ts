import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { LogLevel } from './config.ts';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
  close(): void;
}

interface Sink {
  write(line: string): void;
  close(): void;
}

// size-rotated json lines. no external deps, no async queue — a honeypot log
// that silently drops lines under load is worse than one that blocks for a ms.
class RotatingFileSink implements Sink {
  private fd: number | null = null;
  private bytes = 0;
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly keep: number;

  constructor(dir: string, name: string, maxBytes: number, keep: number) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, name);
    this.maxBytes = maxBytes;
    this.keep = keep;
    this.open();
  }

  private open(): void {
    this.fd = openSync(this.path, 'a');
    this.bytes = existsSync(this.path) ? statSync(this.path).size : 0;
  }

  private rotate(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    for (let i = this.keep - 1; i >= 1; i--) {
      const from = `${this.path}.${i}`;
      const to = `${this.path}.${i + 1}`;
      if (existsSync(from)) renameSync(from, to);
    }
    if (existsSync(this.path)) renameSync(this.path, `${this.path}.1`);
    this.open();
  }

  write(line: string): void {
    if (this.fd === null) return;
    const buf = Buffer.from(line + '\n');
    if (this.bytes + buf.length > this.maxBytes) this.rotate();
    try {
      writeSync(this.fd as number, buf);
      this.bytes += buf.length;
    } catch {
      // disk full or similar. keep serving, keep quiet.
    }
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

class StdoutSink implements Sink {
  write(line: string): void {
    process.stdout.write(line + '\n');
  }
  close(): void {}
}

export function createLogger(opts: {
  level: LogLevel;
  dir?: string;
  file?: string;
  maxMb?: number;
  stdout?: boolean;
  base?: Record<string, unknown>;
}): Logger {
  const sinks: Sink[] = [];
  if (opts.stdout !== false) sinks.push(new StdoutSink());
  if (opts.dir && opts.file) {
    // 10 files of maxMb/10 each so the cap is the whole directory, not one file
    const perFile = Math.max(1, Math.floor(((opts.maxMb ?? 100) * 1024 * 1024) / 10));
    sinks.push(new RotatingFileSink(opts.dir, opts.file, perFile, 10));
  }
  const threshold = LEVELS[opts.level];

  function make(base: Record<string, unknown>): Logger {
    const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
      if (LEVELS[level] < threshold) return;
      const rec = { ts: new Date().toISOString(), level, msg, ...base, ...(fields ?? {}) };
      let line: string;
      try {
        line = JSON.stringify(rec);
      } catch {
        line = JSON.stringify({ ts: rec.ts, level, msg, note: 'unserializable fields dropped' });
      }
      for (const s of sinks) s.write(line);
    };
    return {
      debug: (m, f) => emit('debug', m, f),
      info: (m, f) => emit('info', m, f),
      warn: (m, f) => emit('warn', m, f),
      error: (m, f) => emit('error', m, f),
      child: (f) => make({ ...base, ...f }),
      close: () => sinks.forEach((s) => s.close()),
    };
  }
  return make(opts.base ?? {});
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
  close() {},
};
