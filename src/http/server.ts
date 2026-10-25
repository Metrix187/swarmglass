import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP, type Socket } from 'node:net';
import { decodeURIComponentSafe } from './security.ts';
import { esc } from './html.ts';
import type { Logger } from '../log.ts';

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS' | 'PATCH' | 'OTHER';

export interface Req {
  method: Method;
  rawMethod: string;
  url: string; // raw request target as received (bounded)
  path: string; // decoded, normalized path *without* base path
  fullPath: string; // path including base path, as the client sent it
  query: URLSearchParams;
  headers: Record<string, string>; // lowercased, first value wins, bounded
  rawHeaderNames: string[]; // in wire order
  headerCount: number;
  httpVersion: string;
  remoteIp: string; // socket peer
  clientIp: string; // after trusted-proxy resolution
  proto: 'http' | 'https';
  host: string;
  cookies: Record<string, string>;
  body: Buffer | null; // bounded, only read for POST/PUT/PATCH
  bodyTruncated: boolean;
  startedAt: number;
  params: Record<string, string>;
  // scratch space handlers + middleware share (session, page catalog hits, etc)
  state: Record<string, unknown>;
}

export interface Res {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
  // telemetry hints, never sent on the wire
  meta?: Record<string, unknown>;
}

export type Handler = (req: Req) => Promise<Res> | Res;

export interface Route {
  method: Method | 'ANY';
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  id: string;
}

export interface ServerOptions {
  basePath: string;
  trustProxy: boolean;
  trustedProxies: string[];
  trustCfHeader?: boolean; // honour CF-Connecting-IP from a trusted peer; only behind cloudflare's proxy
  maxBodyBytes: number;
  log: Logger;
  // called after every response with timing; the telemetry hook
  onResponse?: (req: Req, res: Res, latencyMs: number) => void;
  // called before routing; return a Res to short-circuit (rate limiting, allowlists)
  gate?: (req: Req) => Res | null;
  defaultHeaders: Record<string, string>;
  notFound: Handler;
  serverHeader?: string;
}

const MAX_URL = 4096;
const MAX_HEADER_VALUE = 2048;

function compile(pattern: string): { re: RegExp; keys: string[] } {
  // "/wiki/:page" -> /^\/wiki\/([^/]+)$/ ; "/attachments/*rest" -> greedy tail
  const keys: string[] = [];
  const src = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      // "*rest" or "Special:*rest": a literal prefix, then a greedy capture to the end
      const star = seg.indexOf('*');
      if (star >= 0) {
        keys.push(seg.slice(star + 1) || 'rest');
        return seg.slice(0, star).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(.*)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp(`^${src}$`), keys };
}

export class Router {
  readonly routes: Route[] = [];

  add(method: Method | 'ANY', pattern: string | RegExp, handler: Handler, id?: string): this {
    if (pattern instanceof RegExp) {
      this.routes.push({ method, pattern, keys: [], handler, id: id ?? pattern.source });
    } else {
      const { re, keys } = compile(pattern);
      this.routes.push({ method, pattern: re, keys, handler, id: id ?? pattern });
    }
    return this;
  }

  get(pattern: string | RegExp, handler: Handler, id?: string): this {
    return this.add('GET', pattern, handler, id);
  }
  post(pattern: string | RegExp, handler: Handler, id?: string): this {
    return this.add('POST', pattern, handler, id);
  }
  any(pattern: string | RegExp, handler: Handler, id?: string): this {
    return this.add('ANY', pattern, handler, id);
  }

  match(method: Method, path: string): { route: Route; params: Record<string, string> } | { methodMismatch: true } | null {
    let sawPath = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      // the OPTIONS catch-all matches every path. that must not count as "this path exists", or every
      // unknown GET turns into a 405 with an Allow header that says GET is fine (yes, that shipped)
      if (r.method !== 'OPTIONS') sawPath = true;
      const effective = method === 'HEAD' ? 'GET' : method;
      if (r.method !== 'ANY' && r.method !== effective) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponentSafe(m[i + 1] ?? '');
      });
      return { route: r, params };
    }
    return sawPath ? { methodMismatch: true } : null;
  }
}

function toMethod(m: string | undefined): Method {
  switch (m) {
    case 'GET':
    case 'HEAD':
    case 'POST':
    case 'PUT':
    case 'DELETE':
    case 'OPTIONS':
    case 'PATCH':
      return m;
    default:
      return 'OTHER';
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';').slice(0, 32)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k && !(k in out)) out[k] = v.slice(0, 512);
  }
  return out;
}

// normalizes a path: collapses //, resolves . and .., strips trailing slash (except root)
export function normalizePath(p: string): string {
  const segs: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      segs.pop();
      continue;
    }
    segs.push(seg);
  }
  return '/' + segs.join('/');
}

export function readBody(req: IncomingMessage, max: number): Promise<{ body: Buffer; truncated: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    req.on('data', (c: Buffer) => {
      if (truncated) return;
      size += c.length;
      if (size > max) {
        truncated = true;
        chunks.push(c.subarray(0, Math.max(0, max - (size - c.length))));
        // answer now, keep swallowing what is left: a paused body never completes, and thirty seconds later node
        // raises a request timeout on a socket the client may be reusing. the connection is closed after the answer
        resolve({ body: Buffer.concat(chunks), truncated });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!truncated) resolve({ body: Buffer.concat(chunks), truncated });
    });
    req.on('error', () => resolve({ body: Buffer.concat(chunks), truncated: true }));
  });
}

// a forwarded address is only worth anything when a proxy we trust set it, and only for the headers that proxy
// actually sets. X-Real-IP and X-Forwarded-For are what caddy / nginx / traefik write. CF-Connecting-IP is
// cloudflare's, and on a direct origin every one of those proxies passes a visitor's own copy of it straight
// through, which made it a header anyone could use to be anyone: a fresh rate-limit bucket per request, a
// different actor fingerprint per request, a swarm of one. it is ignored unless the operator says the origin sits
// behind cloudflare. a forwarded value that is not an address is ignored too; it would otherwise become a key.
export function resolveClientIp(remote: string, headers: Record<string, string>, opts: { trustProxy: boolean; isTrusted: (ip: string) => boolean; trustCfHeader?: boolean }): string {
  if (!opts.trustProxy || !opts.isTrusted(remote)) return remote;
  if (opts.trustCfHeader) {
    const cf = ipOrNull(headers['cf-connecting-ip']);
    if (cf) return cf;
  }
  const real = ipOrNull(headers['x-real-ip']);
  if (real) return real;
  const xff = headers['x-forwarded-for'];
  if (xff) {
    // walk right-to-left past trusted hops; the first thing that is not an address ends the walk, since
    // everything to its left was written by whoever wrote it
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i] as string;
      if (!isIP(hop)) break;
      if (!opts.isTrusted(hop)) return hop;
    }
    const first = ipOrNull(hops[0]);
    if (first) return first;
  }
  return remote;
}

function ipOrNull(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return s && isIP(s) ? s : null;
}

export function buildReq(incoming: IncomingMessage, opts: { basePath: string; trustProxy: boolean; isTrusted: (ip: string) => boolean; trustCfHeader?: boolean }): Req {
  const rawUrl = (incoming.url ?? '/').slice(0, MAX_URL);
  const headers: Record<string, string> = {};
  const names: string[] = [];
  const rh = incoming.rawHeaders;
  for (let i = 0; i + 1 < rh.length; i += 2) {
    const name = (rh[i] as string).toLowerCase();
    names.push(name);
    if (!(name in headers)) headers[name] = (rh[i + 1] as string).slice(0, MAX_HEADER_VALUE);
  }
  const socket = incoming.socket as Socket;
  const remote = socket.remoteAddress ?? '0.0.0.0';
  const clientIp = resolveClientIp(remote, headers, opts);
  const q = rawUrl.indexOf('?');
  const pathPart = q >= 0 ? rawUrl.slice(0, q) : rawUrl;
  const queryPart = q >= 0 ? rawUrl.slice(q + 1) : '';
  let path = normalizePath(decodeURIComponentSafe(pathPart));
  const fullPath = path;
  if (opts.basePath) {
    if (path === opts.basePath) path = '/';
    else if (path.startsWith(opts.basePath + '/')) path = path.slice(opts.basePath.length);
  }
  const protoHeader = (headers['x-forwarded-proto'] ?? '').toLowerCase();
  const proto: 'http' | 'https' = opts.trustProxy && opts.isTrusted(remote) && protoHeader === 'https' ? 'https' : 'http';
  return {
    method: toMethod(incoming.method),
    rawMethod: incoming.method ?? '',
    url: rawUrl,
    path,
    fullPath,
    query: new URLSearchParams(queryPart.slice(0, 2048)),
    headers,
    rawHeaderNames: names,
    headerCount: names.length,
    httpVersion: incoming.httpVersion,
    remoteIp: remote,
    clientIp,
    proto,
    host: (headers['host'] ?? '').slice(0, 253),
    cookies: parseCookies(headers['cookie']),
    body: null,
    bodyTruncated: false,
    startedAt: Date.now(),
    params: {},
    state: {},
  };
}

export function text(status: number, body: string, headers: Record<string, string> = {}): Res {
  return { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers }, body };
}

export function htmlRes(status: number, body: string, headers: Record<string, string> = {}): Res {
  return { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body };
}

export function json(status: number, data: unknown, headers: Record<string, string> = {}): Res {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(data, null, 2) };
}

export function redirect(status: number, location: string, headers: Record<string, string> = {}): Res {
  return {
    status,
    headers: { location, 'content-type': 'text/html; charset=utf-8', ...headers },
    body: `<!DOCTYPE html><html><head><title>Redirect</title></head><body><a href="${esc(location)}">${esc(location)}</a></body></html>`,
  };
}

const CLIENT_ERROR_TEXT: Record<number, string> = { 400: 'Bad Request', 408: 'Request Timeout', 431: 'Request Header Fields Too Large' };

/** what node's own clientError handling would say, so that browsers keep their retry behaviour */
export function clientErrorReply(code: string, sock: { bytesRead: number; writable: boolean; destroyed: boolean; responseStarted: boolean }): { status: number; line: string | null } {
  const status = code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 408 : code === 'HPE_HEADER_OVERFLOW' || code === 'HPE_CHUNK_EXTENSIONS_OVERFLOW' ? 431 : 400;
  // nothing to answer when nothing was asked: a connection a browser opened ahead of time and never used (chromium
  // keeps spares) times out like any other, and a reset before the first response byte is what makes a browser
  // retry on a fresh connection, where a status line is shown to the user as a failed request. a response already
  // on the wire is never interrupted: a status line in the middle of a body corrupts it
  const quiet = sock.bytesRead === 0 || !sock.writable || sock.destroyed || sock.responseStarted;
  return { status, line: quiet ? null : `HTTP/1.1 ${status} ${CLIENT_ERROR_TEXT[status] ?? 'Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n` };
}

export function createHttpServer(router: Router, opts: ServerOptions & { isTrusted: (ip: string) => boolean }): Server {
  const server = createServer({ maxHeaderSize: 32 * 1024, requestTimeout: 30_000, headersTimeout: 15_000, keepAliveTimeout: 5_000 }, (incoming, outgoing) => {
    void handle(incoming, outgoing);
  });

  async function handle(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    const started = process.hrtime.bigint();
    let req: Req;
    try {
      req = buildReq(incoming, opts);
    } catch (e) {
      opts.log.warn('request build failed', { err: String(e) });
      send(outgoing, { status: 400, headers: { 'content-type': 'text/plain' }, body: 'bad request' }, 'HEAD' as Method, opts);
      return;
    }

    let res: Res;
    try {
      const gated = opts.gate ? opts.gate(req) : null;
      if (gated) {
        res = gated;
      } else {
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          const { body, truncated } = await readBody(incoming, opts.maxBodyBytes);
          req.body = body;
          req.bodyTruncated = truncated;
        }
        const m = router.match(req.method, req.path);
        if (!m) {
          res = await opts.notFound(req);
          res.meta = { ...(res.meta ?? {}), route: 'missing' };
        } else if ('methodMismatch' in m) {
          res = { status: 405, headers: { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' }, body: 'method not allowed', meta: { route: 'method_mismatch' } };
        } else {
          req.params = m.params;
          res = await m.route.handler(req);
          res.meta = { route: m.route.id, ...(res.meta ?? {}) };
        }
      }
    } catch (e) {
      opts.log.error('handler crashed', { err: e instanceof Error ? e.stack ?? e.message : String(e), path: req.path });
      res = { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'internal error', meta: { route: 'error' } };
    }

    // middleware (session cookie etc) leaves headers here; handler headers win on conflict
    const extra = req.state.extraHeaders as Record<string, string> | undefined;
    if (extra) res.headers = { ...extra, ...res.headers };
    // a body we stopped reading is still arriving: let node close the connection once the answer is out
    if (req.bodyTruncated) res.headers = { ...res.headers, connection: 'close' };

    send(outgoing, res, req.method, opts);
    const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (opts.onResponse) {
      try {
        opts.onResponse(req, res, latencyMs);
      } catch (e) {
        opts.log.error('telemetry hook crashed', { err: String(e) });
      }
    }
  }

  // node rejects malformed requests before we see them; still worth counting. the answer follows node's own rules
  // (lib/_http_server.js socketOnError): 408 for a request that stalled, which a browser quietly retries on a fresh
  // connection where a 400 is shown to the user; 431 for oversized headers; 400 for the rest; and nothing at all when
  // a response is already on the wire, since a status line pushed into the middle of someone's body corrupts it.
  // the stalled case is also the one a keep-alive client runs into: a request body nobody drained times out thirty
  // seconds later, by which time the browser may have put its next request on the same socket
  server.on('clientError', (err: Error & { code?: string }, socket: Socket) => {
    const code = err.code ?? 'unknown';
    const sock = socket as Socket & { _httpMessage?: { _headerSent?: boolean } | null; parser?: { incoming?: IncomingMessage | null } | null };
    const inc = sock.parser?.incoming ?? null;
    const { status, line } = clientErrorReply(code, { bytesRead: socket.bytesRead, writable: socket.writable, destroyed: socket.destroyed, responseStarted: Boolean(sock._httpMessage && sock._httpMessage._headerSent) });
    opts.log.debug('client error', { code, status, remote: socket.remoteAddress, port: socket.remotePort, bytes_read: socket.bytesRead, bytes_written: socket.bytesWritten, method: inc?.method, url: inc?.url, complete: inc?.complete, response_in_flight: Boolean(sock._httpMessage) });
    if (opts.onResponse) {
      try {
        const fake: Req = {
          method: 'OTHER',
          rawMethod: '',
          url: '',
          path: '/',
          fullPath: '/',
          query: new URLSearchParams(),
          headers: {},
          rawHeaderNames: [],
          headerCount: 0,
          httpVersion: '',
          remoteIp: socket.remoteAddress ?? '0.0.0.0',
          clientIp: socket.remoteAddress ?? '0.0.0.0',
          proto: 'http',
          host: '',
          cookies: {},
          body: null,
          bodyTruncated: false,
          startedAt: Date.now(),
          params: {},
          state: { clientError: err.code ?? 'unknown' },
        };
        opts.onResponse(fake, { status, headers: {}, body: '', meta: { route: 'client_error', malformed: ['parse_error:' + code] } }, 0);
      } catch {
        // never let telemetry break the socket path
      }
    }
    if (line === null) socket.destroy();
    else socket.end(line);
  });

  return server;
}

function send(outgoing: ServerResponse, res: Res, method: Method, opts: { defaultHeaders: Record<string, string>; serverHeader?: string }): void {
  if (outgoing.headersSent || outgoing.destroyed) return;
  const headers: Record<string, string> = { ...opts.defaultHeaders, ...res.headers };
  const body = typeof res.body === 'string' ? Buffer.from(res.body) : res.body;
  headers['content-length'] = String(body.length);
  if (opts.serverHeader) headers['server'] = opts.serverHeader;
  outgoing.writeHead(res.status, headers);
  if (method === 'HEAD' || res.status === 204 || res.status === 304) outgoing.end();
  else outgoing.end(body);
}

export function bodyBytes(res: Res): number {
  return typeof res.body === 'string' ? Buffer.byteLength(res.body) : res.body.length;
}
