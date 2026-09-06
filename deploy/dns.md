# DNS for Swarmglass

`quantara.cv`'s zone lives on the cPanel host's nameservers (`ns1`/`ns2.appliednetwork1.com`), **not** on Cloudflare. Records are edited in cPanel → Domains → Zone Editor. Nothing in this repo touches DNS automatically; this is the checklist.

## Records (Option A, recommended)

| name | type | value | ttl | notes |
|---|---|---|---|---|
| `swarmglass` | A | `64.181.212.228` | 3600 | quantara-nood (Oracle ARM VM) — public honeypot |
| `research.swarmglass` | A | `64.181.212.228` | 3600 | research console; the proxy allowlists it, DNS is public and that is fine |

Both point at the same box; Caddy routes by hostname. If the VM ever moves, change two A records.

**Do not** add `swarmglass` as a cPanel *subdomain* (Domains → Subdomains). That would create a docroot on the shared host and an A record pointing at `89.117.19.82`, i.e. the wrong server. Add plain A records in the Zone Editor instead. (marginalia.quantara.cv *is* a cPanel subdomain because it is served from that host; swarmglass is not.)

## Verification

```bash
dig +short swarmglass.quantara.cv @ns1.appliednetwork1.com
dig +short swarmglass.quantara.cv @1.1.1.1
curl -sI --resolve swarmglass.quantara.cv:443:64.181.212.228 https://swarmglass.quantara.cv/wiki/Main_Page | head -5
```

The zone's negative TTL is 86400, so a resolver that looked the name up *before* the record existed (your phone hotspot, notably) will serve NXDOMAIN for a day. Public resolvers see it immediately. Test with `--resolve` before concluding anything is broken.

## TLS

Caddy obtains Let's Encrypt certificates on first request once the A record resolves (HTTP-01 on port 80, which is open on quantara-nood). No Cloudflare, no proxying, so the origin IP is public — acceptable for a honeypot that *wants* to be found, and the VM's exposure is limited to 22/80/443 by ufw + the OCI security list.

## Option B (path on the apex)

Not possible on the current cPanel host: no shell, no reverse proxy control, `.htaccess` off limits. If quantara.cv ever moves behind a proxy you control, `deploy/caddy/Caddyfile.optionB` is ready; the app only needs `SWARMGLASS_BASE_PATH=/swarmglass`. Until then, `quantara.cv/swarmglass/` is a static redirect stub on the cPanel host pointing at the subdomain (see `quantara-site/INTEGRATION.md`).
