// tiny pub/sub for the live view. bounded subscribers, never throws into the request path.
export interface LiveEvent {
  ts: number;
  session_id: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  kind: string;
  page_id: string | null;
  ua_family: string;
  synthetic: boolean;
  canaries_seen: number;
  canaries_exposed: number;
  is_new_session: boolean;
}

export class LiveBus {
  private subs = new Set<(e: LiveEvent) => void>();
  private recent: LiveEvent[] = [];
  private readonly keep: number;

  constructor(keep = 200) {
    this.keep = keep;
  }

  publish(e: LiveEvent): void {
    this.recent.push(e);
    if (this.recent.length > this.keep) this.recent.shift();
    for (const s of this.subs) {
      try {
        s(e);
      } catch {
        this.subs.delete(s);
      }
    }
  }

  subscribe(fn: (e: LiveEvent) => void): () => void {
    if (this.subs.size >= 64) throw new Error('too many live subscribers');
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  tail(n = 50): LiveEvent[] {
    return this.recent.slice(-n);
  }

  get subscribers(): number {
    return this.subs.size;
  }
}
