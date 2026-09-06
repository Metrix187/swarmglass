import { isIP } from 'node:net';

// v4 -> 4 bytes, v6 -> 16 bytes, mapped v4 (::ffff:a.b.c.d) collapses to v4
export function ipToBytes(ip: string): Uint8Array | null {
  const kind = isIP(ip);
  if (kind === 4) return v4Bytes(ip);
  if (kind === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped && mapped[1]) return v4Bytes(mapped[1]);
    return v6Bytes(lower);
  }
  return null;
}

function v4Bytes(ip: string): Uint8Array | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return Uint8Array.from(parts);
}

function v6Bytes(ip: string): Uint8Array | null {
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i] ?? '0';
    const n = parseInt(g || '0', 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 0xff;
  }
  return out;
}

export function bytesToIp(b: Uint8Array): string {
  if (b.length === 4) return Array.from(b).join('.');
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)).toString(16));
  return groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
}

// keep the routing prefix, drop the host part. /24 for v4, /48 for v6.
export function truncateIp(ip: string): string | null {
  const b = ipToBytes(ip);
  if (!b) return null;
  if (b.length === 4) {
    b[3] = 0;
    return bytesToIp(b) + '/24';
  }
  for (let i = 6; i < 16; i++) b[i] = 0;
  return bytesToIp(b) + '/48';
}

export function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  if (!base) return false;
  const bb = ipToBytes(base);
  const ib = ipToBytes(ip);
  if (!bb || !ib || bb.length !== ib.length) return false;
  const bits = bitsStr === undefined ? bb.length * 8 : Number(bitsStr);
  if (Number.isNaN(bits) || bits < 0 || bits > bb.length * 8) return false;
  let remaining = bits;
  for (let i = 0; i < bb.length && remaining > 0; i++) {
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if (((bb[i] ?? 0) & mask) !== ((ib[i] ?? 0) & mask)) return false;
    remaining -= take;
  }
  return true;
}

export function inAnyCidr(cidrs: string[], ip: string): boolean {
  return cidrs.some((c) => cidrContains(c, ip));
}
