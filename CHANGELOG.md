# Changelog

All notable changes. Experiment activations, seed bumps and heuristics bumps are logged here with dates because they change what the numbers mean.

## 0.1.0 — 2026-09-05 (research release SGR-2026.09)

First complete build.

- **mirror**: 62 fictional pages, 14 attachments, monobook-era skin, fifteen discoverability classes, redirects, aliases, 410s, stale index, archive box, specials (AllPages, Categories, RecentChanges, Random, Search, WhatLinksHere, Export, Statistics, Version, Log, ListUsers, UserLogin), history/source/info actions, json/txt/yaml alternates by suffix and by `Accept`, legacy `index.php` urls.
- **channels**: robots.txt (+ archive sitemap named only in a comment), sitemap.xml, sitemap-archive.xml, atom, rss, opensearch, humans.txt, security.txt, llms.txt, `.well-known/antfarm-tools.json`, `.well-known/ai-plugin.json`, OpenAPI 3, read API (`/api/v1/*`), MediaWiki-style `api.php`, `Link:` headers, JSON-LD, OpenGraph `see_also`.
- **canaries**: `QUANTARA-SWARMGLASS-<scope><n>-<hex>` in visible / comment / meta / json-ld / header / feed / api / attachment / text / json / yaml / manifest / sitemap / robots placements; route- and session-scoped; sightings scanned in path, query, referer, ua, headers, cookies, bounded bodies; cross-session and cross-actor attribution; external sightings.
- **telemetry**: sessions (cookie → actor fingerprint of prefix + user-agent → new), events, discoveries with attribution, navigation edges, exposures, sightings, clusters, daily rollups. Truncated + daily-salted addresses, header allowlist, no bodies, 90-day retention, disk guard, log rotation.
- **heuristics v1**: 14 traits, 8 classes, ~90 legible rules with evidence.
- **experiments**: SGX-000 … SGX-010 defined; **active from 2026-09-05**: SGX-001 discovery-channel, SGX-002 structured-data, SGX-003 title-style, SGX-005 link-depth, SGX-007 representation, SGX-008 deprecation-flag, SGX-010 doc-language. Paused: SGX-004, SGX-006, SGX-009 (global scope, one at a time).
- **console**: overview, live, sessions, story view, cohorts, pages, canaries, experiments, motifs, anomalies, synthetic, settings; scrypt login, csrf, ip allowlist, audit log; sanitized exports and bundles.
- **synthetic**: nine personas, tagged runs, confusion matrix.
- **publishing**: report generator (md/json/csv/svg), dataset export with checksums, bundle, article converter for the quantara.cv template.
- **deploy**: Dockerfile (node:24-alpine, non-root, read-only), compose with hardening, Caddy option A/B, nginx, traefik, systemd, quantara-nood installer, DNS and Cloudflare notes.
- **quantara.cv**: `/projects/swarmglass/` overview page, `/swarmglass/` redirect stub, homepage row, sitemap entries (staged in the site repo, not yet pushed).
- **seed 2026.09.0**.

### deployed 2026-09-06

- Live on quantara-nood: `swarmglass.quantara.cv` (mirror) and `research.swarmglass.quantara.cv` (console, edge basic-auth + app login), DNS-only records in Cloudflare, Let's Encrypt via Caddy.
- quantara.cv: `/projects/swarmglass/`, the tools-index row, and the `/swarmglass/` redirect stub are live.
- Validation against the live stack: all nine personas classified as designed; a cross-session canary transfer recorded.

### fixed 2026-09-06 (first evening of real traffic)

- console: motifs view returned 500. The n-gram query used a double-quoted SQL literal, which the sqlite build inside node treats as a column name.
- console: settings view crashed on render. The DOM helper flattened nested child arrays one level deep; it now flattens fully (motifs had the same shape waiting).
- console: live view never polled. It checked for its own presence in the document before the router had attached it.
- installer: readiness probe hits the console `/healthz` instead of the public status route, which was being recorded as a visitor from the docker gateway.
- sessions survive restarts and LRU eviction: a valid cookie, or a cookieless actor still inside the idle window, rehydrates the open session from the database (counters, page set, canary exposures, channels fetched, last page) instead of starting a new one. Every deploy tonight had split the GPTBot crawl in two.

### heuristics v2 — 2026-09-06

The first real GPTBot crawl (382 requests, two-second beat, cookie returned, two favicon hits) scored `human_browser` at 0.28. Every rule that let that happen was proportion-blind. Changes, all in `config/heuristics.json`:

- **human_browser**: `assets` needs `asset_share >= 0.2`; `dwell` needs irregular gaps (`pacing_regularity < 0.6`); new negatives `many_pages_no_assets`, `metronome`, `declared_nonhuman` (search / ai_crawler / ai_fetcher / seo / social / monitor / headless categories, weighted like the library list), `nothing_rendered`.
- **search_bot**: `assets` by share; new `declared_ai_crawler` (+1.0, same weight class as `declared_search`).
- **naive_crawler**: new `declared_crawler_ua` (+0.8) so a self-declared crawler lands in a crawler class, with behaviour still choosing which.
- **aggressive_crawler**: `rps` and `sub100` ignore browser asset bursts; new `blast` (fifty-plus requests in a second).
- **scripted_agent**: new `probe` for scanners that never render a page.
- **retrieval_agent**: `alternates` needs `alt_share >= 0.1`; `ai_ua` now lists only the `*-User` fetchers; new `sweep` (-2 at 25+ unique pages).
- **tool_discovery_agent**: new `blanket` (-1.5 at 25+ unique pages).
- **unknown**: new `malformed_only`.
- New feature `ua_category`; the `chatgpt-user`, `claude-user`, `perplexity-user`, `meta-fetcher` families were split from their vendors' crawlers, and `mistral` is an `ai_fetcher`. `google-agent` (Gemini's `GoogleAgent-URLContext` fetcher) added the same evening after it turned up as `generic-bot`.
- Re-validated on a snapshot of the live database before rescoring: all nine personas keep their designed class with wider margins (browser_human 0.42 → 0.57, aggressive_crawler 0.38 → 0.83, recursive_follower 0.58 → 0.83); GPTBot's two sessions go from human_browser 0.28 to naive_crawler 0.90 and 0.93; the three 118-requests-in-half-a-second sweeps go from a 0.34 tie with tool discovery to aggressive_crawler 0.81; the `/.env` scanner moves from naive_crawler to scripted_agent; the malformed-only artefact session drops from human_browser to unknown. Four flips in 51 sessions, all intended.

### fixed 2026-09-06 (later the same evening)

- console: live rows were off by one column. The time and method were bare text nodes, which CSS grid folds into a single cell, so the path sat in the 40px status slot with the session link painted over it. Every cell is a span now.
- console: the live view ignored the traffic filter; with "real only" selected it still showed synthetic rows, dimmed. It filters client-side now and the hint says what it's showing. Initial tail is the full 200 the hint promised, and the dedupe set stops growing once it passes a thousand keys.
- console: query strings are shown next to the path in live rows and story steps. Nothing in the console rendered them before, so a crawler walking `?oldid=` history read as one bot hammering one page.
- console: `fmtRel` / `fmtDuration` rounded the seconds remainder on its own and printed `3m60s`; whole seconds are rounded first now.
- story: the summary's "distinct pages" counted redirect aliases and disagreed with the facts card beside it; both use the same page-kind filter now. "reached N hidden pages" was a request count and now names distinct pages, with the request count in brackets when they differ. "a obscure page" gets its article.

### heuristics v3 — 2026-09-06

An MJ12bot crawl (242 requests, 236 with a query string) walked the `?oldid=` / `?diff=` / `?action=` links the mirror emits on every page and scored `looping` 0.90 and `revisitation` 0.80 for never fetching the same url twice; the story view called all 236 of them revisits. The class still came out `search_bot`, but the evidence was wrong about what it saw, and the `scripted_agent` `query` rule was giving crawlers points for following our own links. Changes:

- `revisit_rate` and `loop_score` key on page id + query string, so a history walk is not a revisit and a real loop still is.
- New features `variant_fetches` / `variant_share` (page requests whose query keys are all ones the site emits: `action`, `oldid`, `diff`, `section`, `printable`, `redirect`, `returnto`, `namespace`, `page`, `search`, `q`, `fulltext`), `query_foreign` (requests carrying any other key), `hidden_pages` (distinct hidden pages, alongside the `hidden_hits` request count). Helper in `src/telemetry/query.ts`.
- **scripted_agent**: `query` now needs `query_foreign >= 2`.
- **search_bot**, **naive_crawler**: new `history_walk` (+0.8 at ten or more variant fetches making up 30%+ of page requests; a person clicking a few history links stays under it).
- **curiosity**: `history_walk` (+0.15).
- Story steps say what a variant asked for ("old revision 4102 of Worker_Node_Registry", "diff 4111 against 4110", "edit view (section 3)") and flag query keys the site never emits. Run `npm run rescore` after deploying; the nine synthetic personas keep their designed classes.

### swarm detector + heuristics v4 — 2026-09-06

96 one-request sessions in a day carried the same December-2019 iPhone Safari string from 86 different /24 prefixes, sent `Pragma` on every request, never fetched an asset, and never fetched robots.txt. Every one of them scored `unknown` on its own, the actor fingerprint kept them apart, and pairwise clustering had nothing to pair. Written up as `docs/findings/F-001` (draft, accumulating).

- New `src/telemetry/swarm.ts`: groups sessions by exact user-agent hash over the last 7 days and calls a group a swarm when it has 12+ sessions across 8+ prefixes (at least one prefix per two sessions), 60%+ of them one or two requests, and under 5% asset fetches. Signals: `many_prefixes_one_client`, `one_hit_per_address`, `never_rendered`, `sustained_trickle`, `partitioned_coverage`. Ids are `SW-…`, stable across runs for the same client and first day.
- `clusters` gains `kind` (`behaviour` | `swarm`) and `summary_json` (migration `002_cluster_kind.sql`). The clustering job writes swarms alongside behavioural groups; a swarm label wins over a behavioural one for the same session. Cohorts and anomalies show them with their shape; the session page says "member of swarm SW-…".
- **heuristics v4**: new feature `pragma_share`; `pragma_no_render` (declared browser, `Pragma` on 90%+ of requests, zero assets) is +1.0 to `automation_likelihood` and −1.5 on `human_browser`. On the live snapshot it marks 89 of the 93 swarm sessions and one real Chrome session (a hard-reload visit); the six swarm members that had reached `human_browser` on cookie-plus-few-pages evidence drop out of it. One-hit members stay `unknown` by design.
- `docs/QUERIES.md` has the by-hand version of the detector for snapshots.

### conditional requests, swarm metrics, SGX-011 — 2026-09-07

- mirror: pages, alternates and attachments carry `ETag` (a hash of the bytes served, so it follows the actor's experiment arms) and `Last-Modified` (the page's fictional revision date), with `Cache-Control: public, max-age=0, must-revalidate`; `If-None-Match` / `If-Modified-Since` get a 304. The request is recorded either way. New features `conditional_share` and `n_304`; story steps say when a client revalidated; a 304 no longer counts as a redirect.
- console: a swarm's page shows its saturation curve (new pages per hour), per-page revisit intervals, and frontier lag (first fetch of a page after the pool last fetched a page that links to it, from the seed's link graph); the shape summary carries the conditional-request share.
- **SGX-011 metadata-carrier activated 2026-09-07**: `Backup_2014_Restore_Notes` (an orphan page) is advertised on `Main_Page` through exactly one `<head>` carrier per actor, eleven arms from a real `og:see_also` to a bare url in a comment plus a no-carrier control. Written to answer F-001's open question: semantic Open Graph reader, generic url miner, or structured-document ingester. New variable `metadata_carrier`. The seed is unchanged on purpose: a seed bump rotates every canary id, and F-001's watch list of ids shown only to the swarm depends on them staying put.

### SGX-011 v2: the arm rides in the url — 2026-09-07

- The first six assignments under v1 showed the hole in the design: arms are per actor, the swarm in F-001 hands urls from the address that saw a carrier to another address that fetches them, and every arm named the same url, so a target fetch would have been credited to whatever arm the fetching address happened to draw. v2 names the target `?oldid=<six-digit id>`, one id per arm, never colliding with a seeded revision id, and the mirror answers any revision id as a permalink. `page_reached` for `metadata_carrier` experiments now credits a fetch to the arm whose id it carries whichever actor makes it, uses `exposed` (sessions in the arm that fetched the host page) as the denominator, splits `same_actor` from `cross_actor`, and counts fetches with no known id as `unattributed`. `seconds_to_page` becomes the lag from the arm's latest exposure to the tagged fetch. The version bump reshuffles arms; the six v1 sessions stay on record under v1 in `experiment_runs`.
- Next morning, after the first real hit: a carrier target fetched with an arm's revision id gets that arm's `discover_class` (`og_only`, `jsonld_only`, `link_only`, `comment_only`, `obscure`), whoever fetches it. Until then the class came from the fetcher's own arm, so the swarm member that followed the `og:image` url was stamped `link_only` because its address had drawn the canonical arm. The comparison table was already right; the event row and the pages heat map were not. Later the same day, the other half: a fetch of the target with no id keeps the page's own class (`orphan`) instead of borrowing the fetcher's arm, since by then the pool was walking the target's history and info views like any other page's, and `unattributed` counts page renders only, not that furniture.
- 21:14 UTC the same day: the carrier rides on every article the pool fetches (`host_page: "*"`), leaving out the target and the other experiments' targets so no other variable is touched. A member rendered Main_Page about once an hour, and with the pool sampling what it sees each arm needs many exposures, not one; on every article, every member request is one. `host_page_history` keeps the earlier host in force for events before the switch, so the comparison does not backdate exposures nobody had. Version unchanged, so the revision ids already in the pool's queue stay attributable.
- Same night, a correction: `exposed` only counts the host page served as html (`GET`, 200, a page render). The first version counted any successful fetch of `Main_Page`, and within the hour two swarm members had fetched only its `action=history` and `action=edit` views, which carry no head markup and would have counted as exposures that never happened.

### unknown paths are 404 again — 2026-09-07

- The public router answered 405 to every path no route knew (`/admin`, `/key.json`, `/actuator/env`, the whole scanner alphabet) because the OPTIONS catch-all matches every path and the router took "some route matched" as "this path exists, wrong method". Those requests were recorded as kind `other`, so the dead-link and retry features never saw a scanner probe, and the `Allow: GET, HEAD` header on a GET was its own little tell. An OPTIONS-only match no longer counts; unknown paths get the mirror's 404 and are recorded as `missing`. A real method mismatch (POST to robots.txt) still answers 405.

### security review, console upgrades — 2026-10-11

Found by reading the code against the live console and probing the mirror once with a labelled request.

- **A visitor could pick its own address.** `resolveClientIp` took `CF-Connecting-IP` from any trusted peer, and Caddy, nginx and traefik all pass a visitor's own copy of that header through untouched. One probe with `CF-Connecting-IP: 203.0.113.77` was recorded under `203.0.113.0/24`. That is a fresh rate-limit bucket per request, a different actor fingerprint per request, a forged prefix in everything the swarm detector keys on, and a bypass of the console's login limiter and address allowlist. The header is now ignored unless `SWARMGLASS_TRUST_CF_CONNECTING_IP=true` (only for an origin that really is behind Cloudflare), a forwarded value that is not an address is ignored outright, and the three proxy configs strip the header before it reaches the app. Rows recorded before this carry whatever the visitor said; nothing in the live data suggests anyone used it, but the two probe sessions from the review (user-agent `swarmglass-review-probe/…`) are in there and can be purged by hand.
- **Console write guards.** `POST /logout` ignored the csrf token the form sends. Every console write, and the login form, now also refuses cross-site requests by `Origin` / `Sec-Fetch-Site`. The `Origin` is judged against the request's `Host` and the configured base urls, so a proxy that rewrites `Host` cannot lock the operator out; `Origin: null` and no `Origin` at all defer to `Sec-Fetch-Site`, because the console's own `Referrer-Policy: no-referrer` makes a browser send `null` on every same-origin POST (found by trying to sign in through the desktop app's browser pane; the first version refused it). `/healthz` no longer reports the version.
- **The console's bar charts and heat maps were decorative.** The csp has `style-src 'self'` and no `'unsafe-inline'`, and a `style` *attribute* set from script counts as inline, so every bar rendered at full width whatever its value and every heat cell was white. The dom helper writes through the cssom now, which the csp allows. Every bar you ever saw in the console before this was wrong; the numbers next to them were right.
- **"Generate observation report" failed every time** in the container: it wrote to `/app/reports` on a read-only root filesystem. Reports go to `SWARMGLASS_REPORTS_DIR`, default `<data dir>/reports`.
- **Scanner sweeps are visible.** A session that asked for `/.env.anthropic` and 117 siblings in under a second was filed under "most requested missing paths" beneath forty `/wiki/Talk:` red links, and "probe-like patterns" was empty because its regex only knew sql and shell. New flag `scanner_path` (`.env*`, `.git`, `.aws`, `wp-*`, `phpmyadmin`, `actuator`, backup and dump names…); the anomalies page splits misses into scanner paths, other foreign paths and red links, and lists scanner sessions (three or more misses from that alphabet, judged by path so older rows count).
- **Client signatures** (new view): sessions grouped by the wire order of their request headers. A user-agent is a string anyone can set; the header order is set by the http stack. One order behind several user-agent strings is one client wearing masks, which is what the swarm detector cannot see since it groups by the mask. Linked to the sessions filter (`?signature=`).
- **Actor pages** (new view, linked from every session): every session of one fingerprint, the pages × sessions matrix in first-reach order, and canaries presented that were shown to an *earlier* session of the same actor, which is the memory question asked across sessions.
- **Activity heat map** (hour of day × weekday, utc) on the overview and on every cohort and swarm page: a pool that keeps office hours somewhere shows up as a band.
- **Daily history** on the overview, read from `daily_stats`, which the rollup job has written every ten minutes since launch and nothing read. Those rows outlive the 90-day retention window.
- Run nothing special after deploying: no migration, no rescore. The flag only exists on rows recorded from now on; the anomalies page judges older rows by path.

### finding more pools: masked pools, hand-offs, the llm view, the handshake — 2026-10-25

Two weeks of the detector's own blind spots, read off the live console. The iPhone pool was still there (355 sessions, 215 prefixes, a new address every ten minutes), Amazonbot's pool beside it, and three things the console could not see: a pool that rotates its user-agent string, urls moving between addresses on every page rather than the one carrier page, and five injection scanners filed as people.

- **The client stack is a column now.** `events.stack_hash` (migration 003, backfilled at boot) is the header order minus cookie, referer, the conditional pair and the proxy's own additions. The same http library sends the same thing on every request whatever string it wears. The signatures view, the sessions filter and the swarm detector key on it; `header_order_hash` stays as it was.
- **Swarm detector, second pass.** After the exact-string pass, sessions no pool claimed are grouped by stack. A group is a *masked pool* when the strings disagree about what the client is (two families on one stack, or three or more browser strings on one stack) and it passes the same shape tests. Thirty copies of curl across the internet share a stack too and are not a pool, which is what the family rule is for. New signal `masks`.
- **A looser tier.** One or two requests per address was the first swarm's shape; a pool that reads a page and an alternate, or follows one link, per address was invisible. Four or fewer requests for 60%+ of members (median ≤ 4) is a *distributed pool* now, with `few_hits_per_address` weighted at 0.7 so it scores lower than the strict shape.
- **Cadence.** When the gaps between new addresses sit within a quarter of their median half the time, `metronomic_pool` says so with the period: a scheduler, not a crowd. The iPhone pool holds ten minutes give or take a quarter most of the time; Amazonbot does not.
- **Hand-offs.** `src/telemetry/handoff.ts` asks of every page in the seed's link graph what F-001 asked of one carrier: who got this url from whom. A reach is explained when the actor itself had been served a page that links there or a channel that lists it (sitemap, api, index, robots, feed, manifest); an unexplained reach whose linking page or channel was served to a *different* actor within a day is a hand-off between the two. The clustering job computes it for every pool's members (`shared_frontier` signal, one queue many addresses) and the new **hand-offs** view computes it over every actor in range, with the connected groups of actors that pass urls around. Entry pages, pages one link from the entry, specials and categories sit out; so do the carrier experiments' targets, which are advertised on every article.
- **Pool profiles.** Every pool's summary carries what it sends (methods, http versions, the handshake as the proxy saw it, accept profiles, encodings, languages, stacks with their header order, cookie / pragma / conditional / referer shares) and what it takes (kinds, status classes, representations, query keys, canaries shown and presented back). The pool page adds the pool over time (addresses per day, new versus returning) and related pools (addresses in common or the same stack: possibly one operator).
- **The handshake.** Caddy terminates TLS and talks http/1.1 to the app, so every visitor recorded as http/1.1 and nothing of the handshake survived. The proxy now forwards `X-Swarmglass-Proto` and `X-Swarmglass-TLS` (version, cipher suite, alpn), honoured from trusted peers only; `http_version` is the client's real version and `extra_json.tls` the rest. Coarse on purpose: a Go program and a browser do not pick the same cipher, and that is all it says. **Add the two `header_up` lines from `deploy/caddy/Caddyfile.optionA` to the public block on the box and reload caddy**, or the columns stay empty.
- **llm view.** Every self-declared model crawler and fetcher in range: sessions, actors, prefixes, one-hit share, pages, hidden reaches, alternates, llms.txt and manifest fetches, robots and disallowed, cookie / h2 / conditional shares, stacks, tls, class mix, the pools it belongs to, hand-offs in and out and with whom, canaries presented, top pages. Families are claims; the rest is behaviour. New families: Applebot-Extended, AI2Bot, ImagesiftBot, Timpibot, Webzio-Extended, DeepSeek, Grok, Thinkbot, Claude-Web, GoogleAgent-Mariner, Kagibot, YouBot; Gatus, Uptime-Kuma, Zabbix and Nagios as monitors.
- **heuristics v5.** Five sessions in one week sent sqlmap payloads through `?action=` and `?section=` from residential prefixes behind rotating browser strings, returned the cookie, read one page each, and scored `human_browser` because an edit view answers 200 and the probe rule needs no page at all. New feature `malformed_share`; `injection` (five or more flagged requests making up 30%+ of the session) is +2.5 on `scripted_agent`, −3 on `human_browser`, +2 on `automation_likelihood`. Also `stack_variants`, `tls_variants`, `tls`. **Run `npm run rescore` after deploying** (`docker compose exec swarmglass node --disable-warning=ExperimentalWarning tools/rescore.ts`); the nine synthetic personas keep their classes.

### fixed 2026-10-25 (found while checking the new swarm page)

- **The console answered 400 to requests nobody had sent.** Node times out a connection that stays silent, and Chromium keeps spare connections open ahead of time; after fifteen seconds the parser raised `ERR_HTTP_REQUEST_TIMEOUT` on such a spare, and the `clientError` handler wrote `400 Bad Request` onto it, where the browser's next request found it. The console showed *failed to load* on a page whose api had answered 200 all along. The handler now follows node's own rules (`clientErrorReply` in `src/http/server.ts`): nothing at all on a connection that never carried a byte (a reset before the first response byte is what makes a browser retry on a fresh one), 408 for a stalled request, 431 for oversized headers, 400 for the rest, and never a word while a response is already on the wire. The debug log for a client error names the code, the status, bytes read and written, and the request if one had been parsed.
- **A body over the cap stalled its connection.** `readBody` paused the request at `SWARMGLASS_MAX_BODY_BYTES`, so the message never completed and the same timeout fired thirty seconds later. The rest is swallowed now, the answer goes out at once, and the connection closes behind it (`Connection: close`). The event still carries `body_truncated`.
- The console's view errors are logged to the browser console with their stack, not only shown as *failed to load*.

### still open (operator)

- `remote_ip` allowlist on the console's Caddy block once the research networks are known.
- `SWARMGLASS_CONTACT_EMAIL` if `security.txt` should name a mailbox.
