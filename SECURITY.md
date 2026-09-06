# Security

Swarmglass is a honeypot in the loosest sense: a website that expects hostile traffic and records it. It is not designed to be attacked *successfully*, and the threat model in `docs/THREAT_MODEL.md` says how it tries to avoid that.

## Reporting

If you find a way to make the public mirror do anything other than serve a page — read a file it should not, make an outbound connection, execute anything, leak telemetry, or reach the research console — please report it privately to the contact in `/.well-known/security.txt` on the running instance, or via the project page at https://quantara.cv/projects/swarmglass/. Expect an acknowledgement within a few days; this is a one-person project.

Please do not run automated scanners against the research console hostname; it is allowlisted and you will only see 403s.

## Scope

- In: the public listener, the console listener, the CLI tools, the Docker/compose/proxy configurations in this repo.
- Out: the fictional content of the wiki (it is supposed to look old and slightly broken), third-party components (Node, SQLite, Caddy), and the host it runs on.

## What we consider a vulnerability

- Any request that causes an outbound connection.
- Any request-derived string reaching a filesystem path, a shell, a template evaluator, or SQL without going through the parameterised layer.
- Any way to read the database, `.env`, or the console without the console credentials *and* an allowlisted source address.
- Any export at *public* level that contains an address, a raw user-agent, a header value, or a query value.
- Any way for an unauthenticated request to be recorded as synthetic, or for synthetic rows to appear in a real-traffic view.

## Hardening checklist for operators

- Console: set `SWARMGLASS_CONSOLE_PASSWORD_HASH`, put the console on its own hostname, set `remote_ip`/`allow` ranges and edge basic-auth at the proxy, and `SWARMGLASS_CONSOLE_IP_ALLOWLIST` in the app.
- Secrets: `SWARMGLASS_SECRET_KEY` ≥ 32 random bytes; rotate it if the box is ever compromised (this invalidates cookies, actor hashes and canary attribution — say so in the changelog).
- Network: bind app ports to loopback; consider `internal: true` for the compose network or `IPAddressDeny` under systemd.
- Updates: rebuild the image regularly (`node:24-alpine` moves).
- Backups of `data/` are as sensitive as the database (coarse, but yours).
