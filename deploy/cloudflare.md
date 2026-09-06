# Cloudflare in front of Swarmglass (optional)

`quantara.cv` is not on Cloudflare, so this is not the default. If you move the zone (or only the `swarmglass` names) behind Cloudflare later, three things matter:

1. **Client addresses.** Cloudflare puts the visitor in `CF-Connecting-IP`. The app honours it only when the TCP peer is in `SWARMGLASS_TRUSTED_PROXIES`. Add Cloudflare's published ranges (fetch them live from `https://www.cloudflare.com/ips-v4` and `ips-v6`; do not hardcode from memory) to that list *and* to Caddy's `trusted_proxies`, exactly as was done for femboys.fyi on the same box.
2. **Bot fight modes will change what you observe.** Cloudflare's bot mitigation, JS challenges and "AI crawler blocking" sit *in front* of the honeypot and filter precisely the traffic Swarmglass exists to study. Turn them off for `swarmglass.quantara.cv` (Security → Bots, and any WAF managed rules that challenge automated clients). Leave caching off too (`Cache Level: Bypass` via a page rule), or the per-actor experiment arms and per-session canaries collapse into whatever Cloudflare cached.
3. **Keep the console name DNS-only (grey cloud).** The console is allowlisted by source address at the proxy; through Cloudflare every request would arrive from a Cloudflare address and the allowlist would either block everyone or nobody.

Record the change in `CHANGELOG.md` and in the research notes: a CDN in front is a methodological change, and a comparison across that boundary is not like-for-like.
