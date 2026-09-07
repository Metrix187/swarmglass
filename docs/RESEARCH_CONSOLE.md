# Research console

`research.swarmglass.quantara.cv` (Option A) or `/__quantara/research` (Option B). Separate listener, separate hostname, source-address allowlist and edge basic-auth at the proxy, then the app's own login. It never shares a cookie, a path, or a header with the public mirror.

Every view has two global controls: **range** (1h … 90d) and **traffic** (*real only* by default; *synthetic only* for pipeline validation; *all*, which shows a warning banner and must never be screenshotted into a publication).

| view | what it shows | questions it answers |
|---|---|---|
| **overview** | totals, requests-per-bucket sparkline with errors, likely-class mix, declared UA families, resource kinds, how pages were first reached, most-reached pages, recent canary sightings, active experiments, storage state | is anything happening; what kind of thing; is the disk fine |
| **live** | the last 200 requests, polled every 2 s; new sessions highlighted; synthetic rows dimmed | what is here *right now* |
| **sessions** | filterable table (class, UA family, minimum requests, free text, cluster, experiment arm); depth, machine fetches, disallowed fetches, cookie return, cohorts | who did the most, who went deepest, who ignored robots |
| **session → story view** | the summary paragraph; caveats; facts; trait bars; class probabilities with the rules that fired; request-gap histogram; navigation graph (force layout, pink visible / purple hidden); pages reached in order with attribution; canaries exposed and presented with cross-session flags; similar sessions; other sessions of the same actor; the step-by-step timeline with per-request notes; raw features | what exactly did this thing do, and how sure are we about the label |
| **cohorts** | clusters over the last 24 h with swarm score, the signals that fired and their notes, members; cohort page adds the page-coverage matrix (which member fetched which page). Distributed swarms (one client signature across many prefixes, one hit each, over the last 7 days) appear here too with their shape summary, and again on the anomalies page | do these sessions look coordinated, and on what evidence |
| **pages** | discoverability class × likely class heat map; the funnel: every page and attachment with sessions, requests, mean time to first reach, attribution breakdown, class breakdown, experiment membership; page view adds time-to-reach distribution and the sessions | which hiding places get found, by whom, how fast |
| **canaries** | issued by placement/scope; sightings by origin placement and by where they came back; the propagation graph (canary ↔ exposed session ↔ presenting session ↔ external); recent sightings with context; a form to record an *external* sighting (search index, forum, model output) | what was read, what was remembered, what crossed sessions |
| **experiments** | the registry with validation problems; activation history with seed/heuristics versions; experiment page: hypothesis, arms with sessions/actors, outcomes with Wilson intervals, class mix, reach-rate bars, bundle downloads (public / internal), fiction map, frozen definition | did the one variable change anything, and how confident is that |
| **motifs** | request n-grams (2–5) shared by multiple sessions, with samples | repeated behaviour across sessions — site shape or coordination |
| **anomalies** | malformed requests with flags, rate-limited sessions, heavy sessions, non-GET methods, write attempts, most-requested missing paths, probe-like patterns, search queries typed into the wiki | what is being pushed on, and what visitors search for |
| **synthetic** | persona × likely-class confusion matrix, mean trait scores per persona, runs | does the pipeline classify its own calibration set as designed |
| **settings** | build/seed/heuristics versions, privacy and limits, storage and pipeline health, job buttons (score, rescore all, recluster, rollup, retention, flush, reload heuristics, generate report), sanitized exports, audit log | operate it |

## Reading a story view

The summary paragraph is generated from features and always uses the same careful grammar: *declared* user-agent family, *likely* class with its margin, counts of what was fetched. The timeline annotates each request with observations such as *path is disallowed by robots.txt, which was read at step 3*, *reached a sitemap-only page — the channel that lists it was fetched at step 7*, *presented canary … in query — it was shown at step 12 (comment) — memory-like reuse*, *continued 200ms after a 429 — ignored Retry-After*, *burst: 6 requests within 90ms*. Flags colour the rows (hidden, canary, disallowed, burst, redirect, missing, gone, limited, malformed, write).

Nothing in the console names a model or a company. If a UA string says "GPTBot", the console says the family is `gptbot` and the tooltip says *self-reported*.

## Screenshots for publications

The console uses Quantara's paper palette and dense mono labels so a cropped table or chart drops straight into an article. Before screenshotting: traffic = *real only*, range shown in the crop, no session ids in the frame (they are local to the instance and meaningless to readers, but they look like something).

## API

All views are thin clients over `/api/*` (JSON, cookie auth, `X-CSRF` on POST). `docs/QUERIES.md` lists the underlying SQL for the questions the console does not ask.
