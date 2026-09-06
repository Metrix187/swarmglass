# Threat model

A honeypot advertises itself to the parts of the internet that are looking for things to push on. Assume hostile traffic finds it. The goal is that nothing it can do matters.

## Assets

1. The rest of Quantara: quantara.cv (cPanel host), its API token, GitHub tokens, the femboys.fyi container on the same VM, SSH keys, DNS.
2. The telemetry database (visitor behaviour; coarse, but ours).
3. The research console (a view into 2 and a way to run jobs).
4. Availability of the mirror (the experiment stops if it falls over).
5. Integrity of findings (synthetic mixed into real, arms tampered with, canaries forged).

## Adversaries

- **Untargeted scanners and crawlers** hammering everything they can enumerate, sending malformed requests, probing for known paths.
- **Curious agents** that read the site and try things: POSTs, odd methods, path tricks, huge headers, canaries with payloads attached.
- **A targeted attacker** who has read this repository and wants the console, the database, or a foothold on the VM.
- **A confused researcher** (us) publishing something that should not leave.

## Boundaries and controls

### Process and host

| control | where |
|---|---|
| separate VM from quantara.cv (which cannot run services anyway) | `deploy/` |
| container: unprivileged user, read-only rootfs, `cap_drop: ALL`, `no-new-privileges`, pid/mem/cpu limits, loopback-only ports | `docker-compose.yml` |
| no outbound connections in code; optional `internal: true` network / systemd `IPAddressDeny` | `docker-compose.yml`, `deploy/systemd/` |
| no host filesystem access beyond `/data`; no docker socket; no shared secrets with any other service | compose |
| separate database file, separate secrets (`SWARMGLASS_SECRET_KEY`, console hash, synth token) | `.env` |
| zero runtime dependencies; the whole surface is in this repo | `package.json` |

### Request handling

| threat | control |
|---|---|
| request smuggling / oversized headers | Node's parser rejects; 32 KB header cap; 15 s header timeout; `clientError` recorded as a malformed event |
| path traversal | normalized paths; assets resolved against the assets dir and checked to stay inside it; no filesystem reads from request paths anywhere else |
| template/expression injection | no template engine; the renderer only ever renders the trusted seed; every request-derived string is escaped or rejected |
| SSRF / visitor-controlled fetches | there is no fetch in the public code path; nothing takes a URL from a request |
| body bombs | bodies capped at `SWARMGLASS_MAX_BODY_BYTES` (64 KB), read only for POST/PUT/PATCH, never stored |
| log injection | control characters scrubbed from every stored string; bounded lengths |
| rate abuse | token bucket per truncated address (30 rps, burst 120 default) → 429 with `Retry-After`; global limits at the proxy |
| disk exhaustion | writer queue bound (20 k), disk guard (degrade at 90%, purge at 100%), log rotation, `mem_limit` |
| header spoofing of client address | `X-Forwarded-For`/`X-Real-IP`/`CF-Connecting-IP` honoured only from `SWARMGLASS_TRUSTED_PROXIES` |
| synthetic tagging by outsiders | the tag header is a shared secret compared in constant time; without it the request is real traffic with a curious header |
| canary forgery | canaries are HMACs; a made-up id is recorded as a sighting of an unknown canary and carries no attribution |
| cache poisoning of per-actor arms | `Vary: Accept` on pages, `Cache-Control: no-store` on anything actor-specific, `Bypass` recommended if a CDN ever sits in front |

### Console

| threat | control |
|---|---|
| exposure to the internet | separate listener bound to loopback; separate hostname; proxy `remote_ip` allowlist + edge basic auth; app-level `SWARMGLASS_CONSOLE_IP_ALLOWLIST` |
| credential attacks | scrypt-hashed single account; 5 attempts / 10 min per prefix; constant-time comparisons; 12-hour server-side sessions |
| CSRF | `SameSite=Strict` cookie + double-submit token on every state change |
| XSS | strict CSP (`default-src 'none'`), no inline scripts, all data via `textContent`; the login page is the only server-rendered form |
| clickjacking / MIME sniffing | `X-Frame-Options: DENY`, `nosniff`, `X-Robots-Tag: noindex` |
| leaking via exports | sanitizer with allowlists and a leak assertion; public/internal levels stamped |
| audit | every login, job, export, bundle, external sighting is written to `audit_log` |

### Findings integrity

- Synthetic rows carry `synthetic = 1` from the first byte and are excluded from every default view and every public export.
- Experiment definitions are frozen into `experiment_runs` at activation with seed and heuristics versions.
- Scores are re-derivable from events; nothing is edited in place except by `rescore`.

## Residual risks (accepted)

- A zero-day in Node's HTTP parser or SQLite. Mitigated by isolation, not eliminated. Keep the image current.
- The VM is shared with femboys.fyi. Containers separate them; the host kernel is common. If that is ever unacceptable, the compose file runs anywhere.
- Coarse actor fingerprints can merge unrelated clients behind one NAT and split one client across sessions. This is a data-quality risk, not a security one, and is documented in `LIMITATIONS.md`.
- The console's edge basic-auth hash and allowlist ranges are operator TODOs. Until they are set, the console is protected by the app login alone and by not being on the public hostname.
