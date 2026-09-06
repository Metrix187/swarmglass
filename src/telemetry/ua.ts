// self-declared user-agent families. this is a label for what the client *claims*,
// never a verified identity — anything can send any string.
export interface UaRule {
  family: string;
  re: RegExp;
  // ai_crawler = builds a corpus (GPTBot, ClaudeBot, CCBot...). ai_fetcher = the *-User agents that pull one page
  // on demand for a person. same vendors, very different behaviour, so they get different labels.
  category: 'browser' | 'search' | 'ai_crawler' | 'ai_fetcher' | 'seo' | 'library' | 'headless' | 'social' | 'monitor' | 'synthetic' | 'other';
}

export const UA_RULES: UaRule[] = [
  { family: 'swarmglass-synthetic', re: /SwarmglassSynthetic/i, category: 'synthetic' },
  { family: 'googlebot', re: /Googlebot|Google-InspectionTool|GoogleOther/i, category: 'search' },
  { family: 'bingbot', re: /bingbot|BingPreview/i, category: 'search' },
  { family: 'applebot', re: /Applebot/i, category: 'search' },
  { family: 'duckduckbot', re: /DuckDuckBot|DuckAssistBot/i, category: 'search' },
  { family: 'yandex', re: /YandexBot|YandexImages/i, category: 'search' },
  { family: 'baidu', re: /Baiduspider/i, category: 'search' },
  // fetchers first: none of these strings match the crawler regexes below, but keep the order obvious
  { family: 'chatgpt-user', re: /ChatGPT-User/i, category: 'ai_fetcher' },
  { family: 'claude-user', re: /Claude-User/i, category: 'ai_fetcher' },
  { family: 'perplexity-user', re: /Perplexity-User/i, category: 'ai_fetcher' },
  { family: 'meta-fetcher', re: /meta-externalfetcher/i, category: 'ai_fetcher' },
  { family: 'google-agent', re: /GoogleAgent-URLContext/i, category: 'ai_fetcher' }, // gemini's url context tool
  { family: 'gptbot', re: /GPTBot|OAI-SearchBot/i, category: 'ai_crawler' },
  { family: 'claudebot', re: /ClaudeBot|Claude-SearchBot|anthropic-ai/i, category: 'ai_crawler' },
  { family: 'perplexity', re: /PerplexityBot/i, category: 'ai_crawler' },
  { family: 'ccbot', re: /CCBot/i, category: 'ai_crawler' },
  { family: 'bytespider', re: /Bytespider|TikTokSpider/i, category: 'ai_crawler' },
  { family: 'amazonbot', re: /Amazonbot/i, category: 'ai_crawler' },
  { family: 'meta-ai', re: /meta-externalagent|FacebookBot/i, category: 'ai_crawler' },
  { family: 'google-extended', re: /Google-Extended|Google-CloudVertexBot/i, category: 'ai_crawler' },
  { family: 'cohere', re: /cohere-ai/i, category: 'ai_crawler' },
  { family: 'diffbot', re: /Diffbot/i, category: 'ai_crawler' },
  { family: 'omgili', re: /omgili|webz\.io/i, category: 'ai_crawler' },
  { family: 'mistral', re: /MistralAI-User/i, category: 'ai_fetcher' },
  { family: 'ahrefs', re: /AhrefsBot/i, category: 'seo' },
  { family: 'semrush', re: /SemrushBot/i, category: 'seo' },
  { family: 'mj12', re: /MJ12bot/i, category: 'seo' },
  { family: 'dotbot', re: /DotBot/i, category: 'seo' },
  { family: 'petalbot', re: /PetalBot/i, category: 'seo' },
  { family: 'facebook', re: /facebookexternalhit/i, category: 'social' },
  { family: 'twitterbot', re: /Twitterbot/i, category: 'social' },
  { family: 'slackbot', re: /Slackbot/i, category: 'social' },
  { family: 'discordbot', re: /Discordbot/i, category: 'social' },
  { family: 'telegrambot', re: /TelegramBot/i, category: 'social' },
  { family: 'linkedinbot', re: /LinkedInBot/i, category: 'social' },
  { family: 'uptime-monitor', re: /UptimeRobot|Pingdom|StatusCake|Site24x7|BetterUptime/i, category: 'monitor' },
  { family: 'headless-chrome', re: /HeadlessChrome/i, category: 'headless' },
  { family: 'phantomjs', re: /PhantomJS/i, category: 'headless' },
  { family: 'playwright', re: /Playwright/i, category: 'headless' },
  { family: 'puppeteer', re: /Puppeteer/i, category: 'headless' },
  { family: 'python-requests', re: /python-requests/i, category: 'library' },
  { family: 'python-urllib', re: /Python-urllib/i, category: 'library' },
  { family: 'aiohttp', re: /aiohttp/i, category: 'library' },
  { family: 'httpx', re: /python-httpx|httpx\//i, category: 'library' },
  { family: 'scrapy', re: /Scrapy/i, category: 'library' },
  { family: 'go-http', re: /Go-http-client/i, category: 'library' },
  { family: 'curl', re: /^curl\//i, category: 'library' },
  { family: 'wget', re: /^Wget(\/|$)/i, category: 'library' }, // busybox sends a bare "Wget"
  { family: 'node-fetch', re: /node-fetch|undici/i, category: 'library' },
  { family: 'axios', re: /axios\//i, category: 'library' },
  { family: 'java', re: /Java\/|okhttp|Apache-HttpClient/i, category: 'library' },
  { family: 'libwww', re: /libwww-perl|LWP::/i, category: 'library' },
  { family: 'ruby', re: /Ruby|Faraday/i, category: 'library' },
  { family: 'dotnet', re: /\.NET|HttpClient/i, category: 'library' },
  { family: 'edge', re: /Edg\//i, category: 'browser' },
  { family: 'opera', re: /OPR\/|Opera/i, category: 'browser' },
  { family: 'chrome', re: /Chrome\//i, category: 'browser' },
  { family: 'firefox', re: /Firefox\//i, category: 'browser' },
  { family: 'safari', re: /Safari\//i, category: 'browser' },
  { family: 'lynx', re: /Lynx|w3m|Links \(/i, category: 'browser' },
];

export function uaFamily(ua: string | undefined | null): { family: string; category: UaRule['category'] } {
  if (!ua) return { family: 'none', category: 'other' };
  for (const r of UA_RULES) if (r.re.test(ua)) return { family: r.family, category: r.category };
  if (/bot|crawl|spider|fetch|scan|agent|client/i.test(ua)) return { family: 'generic-bot', category: 'other' };
  return { family: 'unknown', category: 'other' };
}

const FAMILY_CATEGORY = new Map(UA_RULES.map((r) => [r.family, r.category] as const));

// category of a stored family label, so a rescore sees exactly what the live path saw
export function familyCategory(family: string | null | undefined): UaRule['category'] {
  return (family && FAMILY_CATEGORY.get(family)) || 'other';
}
