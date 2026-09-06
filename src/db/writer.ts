import type { Db } from './db.ts';
import type { Logger } from '../log.ts';

// batches inserts into one transaction every few hundred ms. under a crawl
// storm this is the difference between "fine" and "sqlite lock contention".
export class BufferedWriter {
  private queue: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private closed = false;
  dropped = 0;
  degraded = false; // set by the disk guard: keep serving, stop persisting events

  private readonly db: Db;
  private readonly log: Logger;
  private readonly intervalMs: number;
  private readonly maxQueue: number;

  constructor(db: Db, log: Logger, intervalMs = 250, maxQueue = 20_000) {
    this.db = db;
    this.log = log;
    this.intervalMs = intervalMs;
    this.maxQueue = maxQueue;
  }

  enqueue(op: () => void): void {
    if (this.closed) return;
    if (this.queue.length >= this.maxQueue) {
      this.dropped++;
      if (this.dropped % 1000 === 1) this.log.warn('writer queue full, dropping events', { dropped: this.dropped });
      return;
    }
    this.queue.push(op);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.intervalMs);
      this.timer.unref();
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    const batch = this.queue;
    this.queue = [];
    try {
      this.db.transaction(() => {
        for (const op of batch) {
          try {
            op();
          } catch (e) {
            this.log.error('event write failed', { err: String(e) });
          }
        }
      });
    } catch (e) {
      this.log.error('batch transaction failed', { err: String(e), size: batch.length });
    } finally {
      this.flushing = false;
      if (this.queue.length && !this.closed) {
        this.timer = setTimeout(() => this.flush(), this.intervalMs);
        this.timer.unref();
      }
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  close(): void {
    this.closed = true;
    this.flush();
  }
}
