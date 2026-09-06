// Accept header parsing with q-values. small, strict, no surprises.

export interface AcceptEntry {
  type: string;
  subtype: string;
  q: number;
  order: number;
}

export function parseAccept(header: string | undefined): AcceptEntry[] {
  if (!header) return [{ type: '*', subtype: '*', q: 1, order: 0 }];
  const out: AcceptEntry[] = [];
  const parts = header.split(',').slice(0, 32);
  parts.forEach((part, order) => {
    const [mediaRaw, ...params] = part.trim().split(';');
    if (!mediaRaw) return;
    const media = mediaRaw.trim().toLowerCase();
    const slash = media.indexOf('/');
    if (slash < 0) return;
    const type = media.slice(0, slash) || '*';
    const subtype = media.slice(slash + 1) || '*';
    let q = 1;
    for (const p of params) {
      const [k, v] = p.trim().split('=');
      if (k === 'q' && v !== undefined) {
        const n = Number(v);
        if (Number.isFinite(n)) q = Math.max(0, Math.min(1, n));
      }
    }
    out.push({ type, subtype, q, order });
  });
  return out.length ? out : [{ type: '*', subtype: '*', q: 1, order: 0 }];
}

// picks the best offered content type. offers are full mime types.
// returns null when nothing is acceptable (we still serve a default; the
// negotiation *outcome* is what telemetry cares about).
export function negotiate(accept: string | undefined, offers: string[]): string | null {
  const entries = parseAccept(accept);
  let best: { offer: string; q: number; specificity: number; order: number } | null = null;
  for (const offer of offers) {
    const [ot, os] = offer.toLowerCase().split('/') as [string, string];
    for (const e of entries) {
      const typeMatch = e.type === '*' || e.type === ot;
      const subMatch = e.subtype === '*' || e.subtype === os;
      if (!typeMatch || !subMatch) continue;
      const specificity = (e.type === '*' ? 0 : 1) + (e.subtype === '*' ? 0 : 1);
      if (e.q === 0) continue;
      if (
        !best ||
        e.q > best.q ||
        (e.q === best.q && specificity > best.specificity) ||
        (e.q === best.q && specificity === best.specificity && e.order < best.order)
      ) {
        best = { offer, q: e.q, specificity, order: e.order };
      }
    }
  }
  return best ? best.offer : null;
}

// coarse label of what the client asked for, for telemetry
export function acceptProfile(accept: string | undefined): string {
  if (!accept) return 'none';
  const a = accept.toLowerCase();
  if (a.startsWith('*/*') && !a.includes('text/html')) return 'any';
  const wants: string[] = [];
  if (a.includes('text/html')) wants.push('html');
  if (a.includes('application/json') || a.includes('application/ld+json')) wants.push('json');
  if (a.includes('text/plain')) wants.push('text');
  if (a.includes('application/xml') || a.includes('text/xml') || a.includes('rss') || a.includes('atom')) wants.push('xml');
  if (a.includes('yaml')) wants.push('yaml');
  if (!wants.length) return 'other';
  return wants.join('+');
}
