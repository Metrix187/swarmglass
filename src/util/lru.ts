// tiny bounded map. old entries fall off the end, no timers, no surprises.
export class Lru<K, V> {
  private map = new Map<K, V>();
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }

  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }

  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value as K;
      this.map.delete(first);
    }
  }

  has(k: K): boolean {
    return this.map.has(k);
  }

  delete(k: K): void {
    this.map.delete(k);
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }

  clear(): void {
    this.map.clear();
  }
}
