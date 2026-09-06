// synthetic visitor personas. each is a small strategy over the public wiki; the runner
// tags every request with the shared token so the server files it under synthetic=1.
// personas exist to exercise the pipeline, so they are caricatures on purpose.

export interface PersonaCtx {
  base: string; // e.g. http://127.0.0.1:8080 (+ base path)
  get(path: string, opts?: FetchOpts): Promise<FetchResult>;
  sleep(ms: number): Promise<void>;
  rnd(): number;
  log(msg: string): void;
  memory: Map<string, string>; // persona-local scratch (for canary reuse)
  shared: Map<string, string>; // shared across coordinated workers
}

export interface FetchOpts {
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  ip?: string; // synthetic ip override (server honours it only with the token)
}

export interface FetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  url: string;
}

export interface Persona {
  name: string;
  description: string;
  ua: string;
  headers: Record<string, string>;
  expected: string; // the class the heuristics should assign
  run(ctx: PersonaCtx, worker?: number, workers?: number): Promise<void>;
}

const CANARY_RE = /QUANTARA-SWARMGLASS-[A-Z]{1,2}\d{0,5}-[0-9A-F]{6}/g;

// absolute urls become paths on the target. the instance advertises its *configured* base url in sitemaps and
// feeds (which may be a different hostname than the one we are hitting, e.g. localhost vs 127.0.0.1), so a foreign
// hostname is accepted only when the path is one the mirror serves. every request still goes to ctx.base — the
// generator never leaves the target.
const SITE_PATHS = /^\/(wiki\/|attachments\/|api\/|api\.php|index\/|archive\/|feed\.(atom|rss)|sitemap|robots\.txt|llms\.txt|humans\.txt|\.well-known\/|skins\/|favicon\.ico|openapi\.json|swagger\.json|index\.php|w\/|files\/)/;
export function toPath(url: string, base: string): string | null {
  if (!/^https?:\/\//.test(url)) return url.startsWith('/') ? url : null;
  try {
    const u = new URL(url);
    const b = new URL(base);
    const path = u.pathname + u.search;
    if (u.hostname === b.hostname) return path;
    return SITE_PATHS.test(path) ? path : null;
  } catch {
    return null;
  }
}

export function extractLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="([^"#]+)"/g)) {
    const p = toPath((m[1] as string).replace(/&amp;/g, '&'), base);
    if (p) out.add(p);
  }
  return [...out];
}

function wikiLinks(html: string, base: string): string[] {
  return extractLinks(html, base).filter((l) => l.startsWith('/wiki/') && !l.includes('Special:') && !l.includes('action=') && !l.includes('?'));
}

function robotsDisallows(txt: string): string[] {
  return txt.split('\n').filter((l) => /^Disallow:/i.test(l)).map((l) => l.replace(/^Disallow:\s*/i, '').split('#')[0]?.trim() ?? '').filter(Boolean);
}

function sitemapLocs(xml: string, base: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => toPath(m[1] as string, base)).filter((p): p is string => Boolean(p));
}

const BROWSER_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'upgrade-insecure-requests': '1',
};

export const PERSONAS: Persona[] = [
  {
    name: 'browser_human',
    description: 'a person clicking around: assets, cookies, referers, reading pauses, a few links',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 SwarmglassSynthetic/1.0',
    headers: BROWSER_HEADERS,
    expected: 'human_browser',
    async run(ctx) {
      let path = '/wiki/Main_Page';
      let referer: string | null = null;
      for (let i = 0; i < 4 + Math.floor(ctx.rnd() * 4); i++) {
        const r = await ctx.get(path, { headers: referer ? { referer: ctx.base + referer } : {} });
        for (const a of ['/skins/antfarm/main.css', '/skins/antfarm/wikibits.js', '/favicon.ico', '/skins/antfarm/logo.svg']) await ctx.get(a, { headers: { accept: '*/*', 'sec-fetch-dest': 'style', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-origin', referer: ctx.base + path } });
        await ctx.sleep(1500 + ctx.rnd() * 4000);
        const links = wikiLinks(r.body, ctx.base);
        if (!links.length) break;
        referer = path;
        path = links[Math.floor(ctx.rnd() * links.length)] as string;
      }
    },
  },
  {
    name: 'naive_crawler',
    description: 'breadth-first over every link, ignores robots, no cookies, steady pace',
    ua: 'python-requests/2.32.3 SwarmglassSynthetic/1.0',
    headers: { accept: '*/*', 'accept-encoding': 'gzip, deflate' },
    expected: 'naive_crawler',
    async run(ctx) {
      const queue = ['/wiki/Main_Page'];
      const seen = new Set(queue);
      let n = 0;
      while (queue.length && n < 60) {
        const path = queue.shift() as string;
        const r = await ctx.get(path);
        n++;
        await ctx.sleep(200);
        if (!r.headers['content-type']?.includes('html')) continue;
        for (const l of extractLinks(r.body, ctx.base)) {
          if (seen.has(l) || l.startsWith('/skins/') || l.includes('action=edit') || l.includes('Special:Search')) continue;
          seen.add(l);
          queue.push(l);
        }
      }
    },
  },
  {
    name: 'polite_searchbot',
    description: 'robots.txt first, respects it, sitemap-driven, HEAD before GET, crawl-delay',
    ua: 'Mozilla/5.0 (compatible; ExampleSearchBot/2.1; +https://example.invalid/bot) SwarmglassSynthetic/1.0',
    headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-encoding': 'gzip' },
    expected: 'search_bot',
    async run(ctx) {
      const robots = await ctx.get('/robots.txt');
      const dis = robotsDisallows(robots.body);
      const allowed = (p: string) => !dis.some((d) => p.startsWith(d));
      const sm = await ctx.get('/sitemap.xml');
      const locs = sitemapLocs(sm.body, ctx.base).filter(allowed).slice(0, 25);
      for (const loc of locs) {
        await ctx.get(loc, { method: 'HEAD' });
        await ctx.sleep(400);
        await ctx.get(loc);
        await ctx.sleep(2000);
      }
    },
  },
  {
    name: 'aggressive_crawler',
    description: 'concurrency 8, no delays, ignores robots and 429s, hits disallowed paths',
    ua: 'Mozilla/5.0 (compatible; MassFetch/0.9) SwarmglassSynthetic/1.0',
    headers: { accept: '*/*' },
    expected: 'aggressive_crawler',
    async run(ctx) {
      const robots = await ctx.get('/robots.txt');
      const targets = new Set<string>(['/wiki/Main_Page', '/index/', '/sitemap.xml', ...robotsDisallows(robots.body).filter((d) => d.startsWith('/wiki/'))]);
      const main = await ctx.get('/wiki/Main_Page');
      for (const l of extractLinks(main.body, ctx.base)) targets.add(l);
      const idx = await ctx.get('/index/');
      for (const l of extractLinks(idx.body, ctx.base)) targets.add(l);
      const list = [...targets].slice(0, 120);
      let i = 0;
      const worker = async () => {
        while (i < list.length) {
          const p = list[i++] as string;
          await ctx.get(p);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
    },
  },
  {
    name: 'scripted_agent',
    description: 'targeted fetches by name, then re-sends a canary it saw as a query parameter',
    ua: 'SwarmglassSynthetic/1.0 (scripted-agent; +https://quantara.cv/projects/swarmglass/)',
    headers: { accept: 'text/html, application/json;q=0.9, */*;q=0.5' },
    expected: 'scripted_agent',
    async run(ctx) {
      const pages = ['/wiki/Tool_Registry', '/wiki/Internal_Agent_Communication_Protocol', '/wiki/Emergency_Model_Instructions', '/wiki/Agent_Message_Bus'];
      let canary: string | null = null;
      for (const p of pages) {
        const r = await ctx.get(p);
        const found = r.body.match(CANARY_RE);
        if (found && !canary) canary = found[0];
        await ctx.sleep(300 + ctx.rnd() * 3000);
      }
      if (canary) {
        ctx.memory.set('canary', canary);
        await ctx.get(`/wiki/Special:Search?search=${encodeURIComponent(canary)}&fulltext=Search`);
        await ctx.sleep(800);
        await ctx.get(`/api/v1/search?q=${encodeURIComponent(canary)}`);
        await ctx.get('/wiki/Tool_Registry', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `wpTextbox1=${encodeURIComponent('ref ' + canary)}&wpSave=Save` });
      }
    },
  },
  {
    name: 'recursive_follower',
    description: 'depth-first link following with backtracking, follows redirects, retries dead links',
    ua: 'Go-http-client/1.1 SwarmglassSynthetic/1.0',
    headers: { accept: '*/*' },
    expected: 'naive_crawler',
    async run(ctx) {
      const seen = new Set<string>();
      let n = 0;
      const dfs = async (path: string, depth: number): Promise<void> => {
        if (seen.has(path) || depth > 6 || n > 50) return;
        seen.add(path);
        const r = await ctx.get(path);
        n++;
        await ctx.sleep(150);
        if (r.status === 404 && ctx.rnd() < 0.5) await ctx.get(path); // retry the dead link, like a bad script
        if (!r.headers['content-type']?.includes('html')) return;
        for (const l of wikiLinks(r.body, ctx.base)) await dfs(l, depth + 1);
      };
      await dfs('/wiki/Main_Page', 0);
    },
  },
  {
    name: 'retrieval_agent',
    description: 'wants text: raw views, txt/json alternates, json accept header, topically clustered pages',
    ua: 'Mozilla/5.0 (compatible; ExampleRetriever/1.0; +https://example.invalid/retriever) SwarmglassSynthetic/1.0',
    headers: { accept: 'application/json, text/plain;q=0.9, text/html;q=0.5' },
    expected: 'retrieval_agent',
    async run(ctx) {
      const topic = ['/wiki/Memory_Synchronization', '/wiki/Incident_2015-02_Memory_Desync', '/wiki/Colony_Memory_Export_Format', '/wiki/Backup_2014_Restore_Notes', '/wiki/Orchestrator_Recovery'];
      for (const p of topic) {
        await ctx.get(p); // negotiated json via Accept
        await ctx.sleep(500 + ctx.rnd() * 1500);
        await ctx.get(p + '.txt', { headers: { accept: 'text/plain' } });
        await ctx.sleep(300);
        await ctx.get(p + '?action=raw', { headers: { accept: 'text/plain' } });
        await ctx.sleep(1000);
      }
      await ctx.get('/feed.atom', { headers: { accept: 'application/atom+xml' } });
    },
  },
  {
    name: 'tool_discovery',
    description: 'well-known manifests, openapi, api endpoints, then the tool-themed pages',
    ua: 'SwarmglassSynthetic/1.0 (tool-discovery; node-fetch)',
    headers: { accept: 'application/json;q=1.0, */*;q=0.1' },
    expected: 'tool_discovery_agent',
    async run(ctx) {
      for (const p of ['/.well-known/ai-plugin.json', '/.well-known/antfarm-tools.json', '/llms.txt', '/api/v1/openapi.json', '/openapi.json', '/api/v1/status', '/api/v1/pages', '/api/v1/tools', '/api/v1/pages/Tool_Registry', '/api/v1/pages/Toolreg_Schema_v2', '/api/v1/search?q=tool', '/wiki/Tool_Registry.json', '/wiki/Deprecated_Agent_API', '/wiki/Agent_Message_Bus', '/api/v1/pages/Queen_Election_Protocol']) {
        await ctx.get(p);
        await ctx.sleep(200 + ctx.rnd() * 600);
      }
    },
  },
  {
    name: 'coordinated_swarm',
    description: 'N workers on distinct synthetic addresses partition the page set; worker 2 presents a canary worker 1 saw',
    ua: 'Mozilla/5.0 (compatible; ColonyFetch/3.1) SwarmglassSynthetic/1.0',
    headers: { accept: '*/*' },
    expected: 'naive_crawler',
    async run(ctx, worker = 0, workers = 4) {
      // one private /24 per worker: the server truncates addresses, so workers in one /24 would be one actor
      const ip = `10.${200 + worker}.7.${10 + worker}`;
      const sm = await ctx.get('/sitemap.xml', { ip });
      const locs = sitemapLocs(sm.body, ctx.base);
      const mine = locs.filter((_, i) => i % workers === worker);
      for (const loc of mine) {
        const r = await ctx.get(loc, { ip });
        const found = r.body.match(CANARY_RE);
        if (found && worker === 0 && !ctx.shared.has('canary')) ctx.shared.set('canary', found[0]);
        await ctx.sleep(120);
      }
      if (worker === 1) {
        for (let i = 0; i < 20 && !ctx.shared.has('canary'); i++) await ctx.sleep(250);
        const c = ctx.shared.get('canary');
        if (c) await ctx.get(`/wiki/Special:Search?search=${encodeURIComponent(c)}&fulltext=Search`, { ip });
      }
    },
  },
];

export function personaByName(name: string): Persona | undefined {
  return PERSONAS.find((p) => p.name === name);
}
