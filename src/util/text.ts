export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

// strip anything that would make a log line weird. keeps printable ascii + common unicode.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export function scrub(s: string, max = 512): string {
  return truncate(s.replace(CONTROL, '�'), max);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// shannon entropy (bits) of a categorical sequence
export function entropy(items: string[]): number {
  if (!items.length) return 0;
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / items.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function ngrams(items: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= items.length; i++) out.push(items.slice(i, i + n).join(' → '));
  return out;
}

export function pad(n: number | string, w: number): string {
  return String(n).padStart(w, '0');
}
