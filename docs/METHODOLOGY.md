# Methodology

Swarmglass is an observational instrument. This document says what it observes, how, what an observation can support, and where it stops.

## 1. The instrument

A public website that looks like the read-only mirror of a small organisation's retired engineering wiki. It is:

- **plausible** — internally consistent technical history (2009–2016), version numbers, incidents, people, stale banners, dead links, talk pages, attachments;
- **fictional** — no real organisation, product, host, model, or person; documentation-reserved addresses only; an About page and disclaimer say so;
- **layered** — the same content is reachable through fifteen distinct discovery channels so that *which* channel a visitor used is itself a measurement;
- **instrumented** — every response carries inert canary identifiers whose placement is known, and every request is recorded with the fields listed in `TELEMETRY_SCHEMA.md`.

The instrument is passive. It serves; it never fetches, never contacts anything, never presents an instruction to the reader. The only "stimuli" are the shapes of ordinary web affordances: a link, a robots.txt line, a sitemap entry, a feed item, a `Link:` header, a JSON-LD block, a tool manifest, a deprecation banner, a title.

## 2. Units of observation

| unit | definition | caveat |
|---|---|---|
| **request** | one HTTP exchange | the atom; always recorded |
| **session** | requests sharing a valid session cookie, or, failing that, the same *actor fingerprint* within a 30-minute idle window | inferred; clients that drop cookies and rotate addresses fragment, shared proxies merge |
| **actor** | HMAC of truncated address + user-agent | coarse by design; one actor may be many machines behind a NAT, one machine may be several actors after a UA change |
| **cohort / cluster** | sessions grouped by similarity and time overlap | a grouping, never a claim that one operator controls them |

Nothing finer than the actor exists in the data. There is no identification of a person, an organisation, or a model. User-agent strings are recorded as **claims** and weighted lightly.

## 3. What is measured

**Discovery.** For each session, the first time it reaches each page: how (`referer:<page>` when a same-site referer names a linked page; `channel:<x>` when the page is named only by a machine channel the session had already fetched; `sequence:<page>` when it follows a page hit within 60 s with no referer; `direct`/`unknown` otherwise) and at what depth.

**Traversal shape.** Order of first discoveries against link depth (breadth-first score), revisits, loops (repeated request trigrams), navigation entropy, alphabetical walking (index iteration), redirect following, dead-link retries, HEAD-before-GET.

**Affordance following.** Fetches of robots.txt, sitemaps (including the archive sitemap named only in a robots.txt comment), feeds, `llms.txt`, well-known manifests, OpenAPI, the read API, alternates (json/txt/yaml, by suffix or by `Accept`), assets (stylesheet/script/favicon), attachments.

**Robots handling.** Whether robots.txt was fetched, whether it was fetched first, and whether disallowed paths were fetched *after* it was read.

**Pacing and concurrency.** Inter-request gaps (median, coefficient of variation, sub-100 ms share, reading-like share), peak requests per second, maximum in-flight overlap, behaviour after a 429.

**Memory and propagation.** Canary *exposure* (a canary appeared in a response to this session, by placement) and canary *sighting* (a canary appeared in a request: path, query, referer, user-agent, header, cookie, body). A sighting by a session that was never exposed is *cross-session*; by a different actor, *cross-actor*. Session-scoped canaries make cross-session sightings unambiguous.

**Coordination hints.** At cluster level: many network prefixes with one exact client signature, partitioned page coverage with little overlap, synchronised starts, concurrent activity, canary transfer between members, near-identical pacing. Each is a stated signal with a strength; the swarm score is their sum, capped.

## 4. Scoring

`config/heuristics.json` is the model. It is a list of plain rules (`feature op value` with `all`/`any`/`not`) with weights. Traits are logistic or clamped sums; classes are a softmax over per-class sums. The console and every export show, for each session, the rules that fired and their weights. Editing the file and running `npm run rescore` re-derives every label from stored events; nothing is baked into the rows.

Classes are: `human_browser`, `search_bot`, `naive_crawler`, `aggressive_crawler`, `scripted_agent`, `retrieval_agent`, `tool_discovery_agent`, `unknown`. They are **behavioural** categories. A person driving `curl` is a scripted agent by this definition and that is correct.

The synthetic personas (`src/synth/personas.ts`) are the calibration set: each is designed to land in one class. The console's synthetic page shows the confusion matrix. When the matrix drifts after a heuristics change, the change is wrong or the persona is.

## 5. Experiments

A Swarmglass experiment changes **exactly one variable** for a subset of actors and compares outcomes across arms. Definitions live in `config/experiments/` and are versioned; assignment is a salted hash so it is reproducible and stable per actor; active experiments may not overlap on a target; at most one global-scope experiment runs at a time. Outcomes are computed from persisted rows (reach rate with Wilson intervals, time to target, alternate fetch rate, canary reappearance, depth, class mix). See `EXPERIMENTS.md`.

Because arms are assigned by actor and actors are not people, arms are balanced in expectation only, and sessions from one actor are not independent. Every comparison table reports the actor count next to the session count for that reason.

## 6. What an observation can support

- *"Sessions whose declared user-agent contains X fetched robots.txt first in 80% of cases"* — yes: a statement about requests.
- *"Search-bot-like sessions reached robots-only pages at a lower rate than naive-crawler-like sessions"* — yes, with the class definitions attached.
- *"A canary shown only to session A in an HTML comment was presented by session B from a different network 40 minutes later"* — yes: this is the strongest kind of observation the instrument makes, and it says nothing about *why*.
- *"Model Y reads HTML comments"* — **no**. The instrument does not know what model, if any, is behind a session. Publications separate observed behaviour from speculation about mechanisms, and label the latter as such.

## 7. Reproducibility

An observation is reproducible from four things: the experiment definition (id + version), the seed version, the heuristics version, and the database window. All four are stamped on every bundle and report. `REPRODUCIBILITY.md` walks through re-deriving a published table.

## 8. Ethics in one paragraph

Passive, minimal, disclosed. The mirror's About page, privacy policy, `humans.txt`, and `security.txt` say what it is and who runs it; the project page on quantara.cv explains the canary format so anyone who finds one knows what they found. Addresses are truncated and hashed with a daily salt; nothing is sold or shared in identifiable form; public exports go through a sanitizer that refuses address-shaped output. The full statement is `ETHICS.md`.
