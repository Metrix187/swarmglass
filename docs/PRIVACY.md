# Privacy design

What is recorded, what is not, how it is transformed, how long it lives, and what leaves.

## Collected per request

| field | form stored | why |
|---|---|---|
| time | unix ms | ordering, pacing |
| method, path, query | scrubbed, bounded; query values with secret-looking keys (`token`, `key`, `auth`, `password`, `session`…) redacted to their length | what was asked for |
| status, latency, bytes | numbers | what was answered |
| network address | **truncated** (`/24` v4, `/48` v6) and **hashed** with an HMAC whose salt rotates daily; full address never stored by default | "same network" reasoning, rate limiting, day-scale linking |
| user-agent | bounded raw string on the session + hash on events | family labelling (treated as a claim) |
| `Accept`, `Accept-Language`, `Accept-Encoding` | bounded raw | negotiation behaviour |
| referer | same-site: path; other sites: **hostname only** | navigation graph; never a foreign URL with its query string |
| header *names* in wire order + a hash of that order + count | names only | client fingerprint at family level |
| a short allowlist of harmless header values (`Sec-Fetch-*`, `Sec-CH-UA*`, `DNT`, `Cache-Control`, `Range`, `If-*`, `X-Requested-With`, `Purpose`) | bounded | browser-vs-library signals |
| cookie presence and validity | booleans | continuity |
| request body | **not stored**; the first 16 KB is scanned for canaries and only matches are kept, plus size and content-type | write attempts are interesting, contents are not |
| TLS/HTTP version, scheme | from the proxy headers | protocol behaviour |
| canaries exposed / seen | identifiers | the point of the exercise |
| experiment cohorts | arm ids | comparison |

Headers named `Authorization`, `Proxy-Authorization`, `Cookie`, `X-Api-Key`, `X-Auth-Token` are never recorded in any form beyond the boolean "a cookie was present".

## Not collected

Full addresses (unless `SWARMGLASS_PRIVACY_IP_MODE=none`, which also requires updating the seed's privacy page), account data (none exists), request bodies, foreign referer URLs, arbitrary header values, geolocation, ASN, reverse DNS, TLS fingerprints (JA3 etc.), anything from third parties.

## Identifiers

- **session id**: random, in an `HttpOnly` cookie signed with the secret key; nothing else in the cookie.
- **actor hash**: HMAC(secret, truncated address + user-agent). Coarse on purpose. Rotating the secret key invalidates every actor hash.
- **ip hash**: HMAC(daily salt, full address); the salt is derived from the secret and the day, so the hash links within a day and dissolves after.
- **console session**: separate cookie, separate table, 12-hour life.

## Retention

- Events, discoveries, edges, exposures, sightings, sessions, clusters: `SWARMGLASS_RETENTION_DAYS` (default 90), purged hourly.
- External sightings recorded by a researcher: kept (they contain no visitor data).
- Logs: size-rotated json lines, capped at `SWARMGLASS_MAX_LOG_MB` total; they carry paths and status, never addresses beyond the truncated form in warnings.
- Disk guard: at 90% of `SWARMGLASS_MAX_DB_MB` new events stop being written; at 100% the oldest 10% are purged. Sessions continue to be counted.

## What leaves the instance

Only through `src/publish/sanitize.ts`:

- **public level**: re-keyed session/actor labels (`S-0001`, `A-0001`, per export), user-agent *family* only, hour-resolution timestamps, relative event times, no network prefix, external referers reduced to "external", query *keys* only, canary ids, features, scores with evidence. The sanitizer throws if the output contains anything address-shaped or header-shaped.
- **internal level**: adds truncated prefixes, raw user-agent strings, exact timestamps, sanitized query values. Never published; for the researcher's own analysis.

Reports and bundles stamp their level. Anything at internal level says "never publish" in its own text.

## Controls (env)

`SWARMGLASS_PRIVACY_IP_MODE` (`truncate` | `hash` | `truncate_hash` | `none`), `SWARMGLASS_IP_SALT_ROTATION_DAYS`, `SWARMGLASS_RETENTION_DAYS`, `SWARMGLASS_HEADER_CAPTURE` (`allowlist` | `names_only`), `SWARMGLASS_STORE_QUERY` (`sanitized` | `none`), `SWARMGLASS_MAX_DB_MB`, `SWARMGLASS_MAX_LOG_MB`.

## Data subject requests

There is no way to find "a person" in the database, which is the intended answer. A request naming an address can be honoured by deleting rows whose `ip_trunc` matches the prefix and whose `ip_hash` matches for the days in question; `tools/purge.ts` is the starting point.
