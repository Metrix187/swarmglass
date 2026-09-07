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
- Same night, a correction: `exposed` only counts the host page served as html (`GET`, 200, a page render). The first version counted any successful fetch of `Main_Page`, and within the hour two swarm members had fetched only its `action=history` and `action=edit` views, which carry no head markup and would have counted as exposures that never happened.

### unknown paths are 404 again — 2026-09-07

- The public router answered 405 to every path no route knew (`/admin`, `/key.json`, `/actuator/env`, the whole scanner alphabet) because the OPTIONS catch-all matches every path and the router took "some route matched" as "this path exists, wrong method". Those requests were recorded as kind `other`, so the dead-link and retry features never saw a scanner probe, and the `Allow: GET, HEAD` header on a GET was its own little tell. An OPTIONS-only match no longer counts; unknown paths get the mirror's 404 and are recorded as `missing`. A real method mismatch (POST to robots.txt) still answers 405.

### still open (operator)

- `remote_ip` allowlist on the console's Caddy block once the research networks are known.
- `SWARMGLASS_CONTACT_EMAIL` if `security.txt` should name a mailbox.
