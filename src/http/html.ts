// html escaping + a tagged template that escapes interpolations by default.
// there is deliberately no template engine here: nothing from a request is
// ever evaluated, only escaped and concatenated.

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

export function escAttr(s: unknown): string {
  return esc(s);
}

export class Raw {
  readonly html: string;
  constructor(html: string) {
    this.html = html;
  }
  toString(): string {
    return this.html;
  }
}

export function raw(html: string): Raw {
  return new Raw(html);
}

type Piece = string | number | boolean | null | undefined | Raw | Piece[];

function render(p: Piece): string {
  if (p === null || p === undefined || p === false) return '';
  if (p instanceof Raw) return p.html;
  if (Array.isArray(p)) return p.map(render).join('');
  if (p === true) return '';
  return esc(p);
}

export function html(strings: TemplateStringsArray, ...values: Piece[]): Raw {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += render(values[i]);
  }
  return new Raw(out);
}

export function join(items: Raw[], sep = ''): Raw {
  return new Raw(items.map((r) => r.html).join(sep));
}

// url-safe path segment for wiki titles: spaces -> underscores, keep unicode, encode the rest
export function pageHref(id: string): string {
  return encodeURIComponent(id.replace(/ /g, '_')).replace(/%3A/gi, ':').replace(/%2F/gi, '/');
}

export function xmlEsc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}
