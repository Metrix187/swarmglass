# DNS for Swarmglass

**Where the zone lives (checked 2026-09-06):** `quantara.cv` is served by Cloudflare's nameservers (`blair.ns.cloudflare.com`, `ruben.ns.cloudflare.com`). The cPanel host still carries a copy of the zone in its Zone Editor and its own nameservers (`ns1`/`ns2.appliednetwork1.com`) will happily answer for it, but nobody on the internet asks them. Records added there do nothing until the domain's registrar NS entries point back at cPanel.

Always check before assuming:

```bash
dig +short NS quantara.cv @1.1.1.1
```

## Records (Option A, recommended)

Add in the Cloudflare dashboard → quantara.cv → DNS → Records. Both **DNS only** (grey cloud), not proxied: the honeypot wants to see real clients, Cloudflare's bot mitigation would filter exactly the traffic under study, and Caddy needs a direct path for its ACME challenge.

| name | type | value | proxy | ttl | notes |
|---|---|---|---|---|---|
| `swarmglass` | A | `<quantara-nood public ip>` | DNS only | auto | public mirror |
| `research.swarmglass` | A | `<quantara-nood public ip>` | DNS only | auto | research console; the proxy layer on the box does the gating |

Both point at the same box; Caddy routes by hostname. If the VM ever moves, change two records.

The same two records also exist in the cPanel zone copy (added 2026-09-06 through `DNS::mass_edit_zone`, serial 2026090600). That is harmless and would become live automatically if the domain ever returned to cPanel's nameservers.

## Verification

```bash
dig +short swarmglass.quantara.cv @1.1.1.1
dig +short research.swarmglass.quantara.cv @1.1.1.1
curl -sI https://swarmglass.quantara.cv/robots.txt | head -3
```

Cloudflare-served records propagate within seconds. If a resolver you use looked the name up *before* the record existed, it may hold a negative answer for a while; test against `1.1.1.1` or with `--resolve` before concluding anything is broken.

## TLS

Caddy obtains Let's Encrypt certificates once the names resolve publicly (HTTP-01 / TLS-ALPN-01 on ports 80/443, both open on quantara-nood). Until then the ACME client logs `NXDOMAIN` and retries with backoff; a `systemctl reload caddy` after the records land makes it retry immediately.

The origin IP is public by design for this host. Exposure is limited to 22/80/443 by ufw and the OCI security list; see `docs/THREAT_MODEL.md` for what that means and `deploy/cloudflare.md` for the proxied alternative and its costs.

## Option B (path on the apex)

Not possible on the current cPanel host: no shell, no reverse proxy control, `.htaccess` off limits. If the apex ever moves behind a proxy you control, `deploy/caddy/Caddyfile.optionB` is ready; the app only needs `SWARMGLASS_BASE_PATH=/swarmglass`. Until then, `quantara.cv/swarmglass/` is a static redirect stub on the cPanel host pointing at the subdomain (see `quantara-site/INTEGRATION.md`).
