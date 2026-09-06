# Cloudflare and Swarmglass

`quantara.cv`'s zone is served by Cloudflare's nameservers (verified 2026-09-06 with `dig NS`). That decides where DNS records go; it does not decide whether traffic to the honeypot is *proxied*. The swarmglass names are **DNS-only** (grey cloud) on purpose.

## Why the mirror is not proxied

1. **Bot mitigation filters the subject of the study.** Cloudflare's bot fight modes, JS challenges and "AI crawler blocking" sit in front of the origin and drop or challenge precisely the automated clients Swarmglass exists to observe. What reached the mirror would be a sample shaped by someone else's rules.
2. **Caching collapses the experiments.** Arms are assigned per actor and canaries can be per session; a cached page serves one actor's arm and one session's canaries to everybody. `Vary: Accept` and `no-store` on the actor-specific responses help, but a CDN in front is a methodological change and a comparison across that boundary is not like-for-like.
3. **Client addresses.** Behind the proxy every request arrives from a Cloudflare address; the app honours `CF-Connecting-IP` only when the TCP peer is in `SWARMGLASS_TRUSTED_PROXIES`. Doable (the femboys.fyi block on the same box already carries Cloudflare's published ranges in Caddy's `trusted_proxies`), but it adds a trust step that is simply unnecessary for a direct origin.
4. **The console allowlist.** `research.swarmglass` must stay DNS-only regardless: a source-address allowlist at the proxy is meaningless when every request comes from Cloudflare.

The cost of DNS-only is that the origin IP is public. That was accepted deliberately for this deployment (the host's exposure is ports 22/80/443 behind ufw and the OCI security list); see `docs/THREAT_MODEL.md`.

## If you ever do proxy it

- Add Cloudflare's current ranges (fetch `https://www.cloudflare.com/ips-v4` and `ips-v6` live, never from memory) to `SWARMGLASS_TRUSTED_PROXIES` *and* to Caddy's `trusted_proxies`.
- Turn off bot mitigation and any WAF managed rules that challenge automated clients for `swarmglass.quantara.cv`; set caching to bypass for the host.
- Keep `research.swarmglass` grey.
- Record the change in `CHANGELOG.md` and in the next finding's caveats; do not compare windows across the change without saying so.
