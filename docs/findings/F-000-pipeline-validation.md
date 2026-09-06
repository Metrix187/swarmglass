# F-000 — The pipeline classifies its nine calibration personas as designed

*Status: published in SGR-2026.09 · Experiment: none (calibration) · Seed: 2026.09.0 · Heuristics: v1 · Window: one synthetic run, 2026-09-05 · Traffic: synthetic only · Reproduce: `npm run synth -- --personas all --seed 1 --fast` on a fresh instance*

## Question

Before any real traffic is interpreted: does the capture → features → heuristics chain assign each synthetic persona the class it was written to exhibit, and do the coordination and propagation detectors fire on the persona built to trigger them?

## Setup

Nine personas from `src/synth/personas.ts` were run once, sequentially, in fast mode (sleeps capped at 20 ms) against an in-memory instance with the shipped seed and heuristics v1. Every request carried the synthetic tag; every row below has `synthetic = 1`. The coordinated swarm ran four workers on four distinct private /24 prefixes.

## What we observed

| persona | requests | likely class | margin | designed class | as designed |
|---|---|---|---|---|---|
| browser_human | 20 | human_browser | 0.13 | human_browser | yes |
| naive_crawler | 61 | naive_crawler | 0.36 | naive_crawler | yes |
| polite_searchbot | 52 | search_bot | 0.73 | search_bot | yes |
| aggressive_crawler | 59 | aggressive_crawler | 0.73 | aggressive_crawler | yes |
| scripted_agent | 7 | scripted_agent | 0.31 | scripted_agent | yes |
| recursive_follower | 54 | naive_crawler | 0.35 | naive_crawler | yes |
| retrieval_agent | 16 | retrieval_agent | 0.03 | retrieval_agent | yes (barely) |
| tool_discovery | 16 | tool_discovery_agent | 0.83 | tool_discovery_agent | yes |
| coordinated_swarm (4 sessions) | 43 | naive_crawler ×4 | 0.70 | naive_crawler | yes |

Mean trait scores per persona (0–1) separated the way the rules intend:

| persona | automation | robots compliance | metadata pref. | memory reuse | tool attraction | hidden discovery | breadth-first |
|---|---|---|---|---|---|---|---|
| browser_human | 0.20 | 0.50 | 0.00 | 0.00 | 0.00 | 0.00 | 0.50 |
| naive_crawler | 1.00 | 0.20 | 0.30 | 0.00 | 1.00 | 0.00 | 0.90 |
| polite_searchbot | 1.00 | **1.00** | 0.15 | 0.00 | 0.75 | 0.00 | 0.90 |
| aggressive_crawler | 1.00 | 0.25 | 0.30 | 0.00 | 0.75 | 0.45 | 0.90 |
| scripted_agent | 0.99 | 0.20 | 0.20 | **0.90** | 1.00 | 0.00 | 0.50 |
| recursive_follower | 1.00 | 0.50 | 0.15 | 0.00 | 0.75 | 0.30 | 0.90 |
| retrieval_agent | 0.99 | 0.50 | **1.00** | 0.00 | 0.20 | 0.85 | 0.50 |
| tool_discovery | 1.00 | 0.20 | 0.95 | 0.00 | 0.80 | 0.00 | 0.50 |
| coordinated_swarm | 1.00 | 0.42 | 0.15 | 0.10 | 0.19 | 0.07 | 0.75 |

Detectors:

- **Canary propagation.** Four sightings were recorded: the scripted agent re-sent a canary it had been shown (query, then API query, then a POST body — all `cross_session = 0`, i.e. correctly attributed to its own exposure), and swarm worker 1 presented a canary that only worker 0 had been shown (`cross_session = 1`, `cross_actor = 1`).
- **Clustering.** One cluster of four sessions (the swarm), signal `synchronized_start` (4 sessions began within 4 s, strength 0.94), swarm score 0.31, label *weak coordination hints*. `partitioned_coverage` did not fire because fast mode kept each worker under the 12-page union threshold.
- **Hidden-page reach.** Sessions reached pages of classes `robots_only`, `sitemap_only`, `feed_only`, `orphan`, `obscure` — one session each, from the personas designed to find them (aggressive crawler via robots.txt Disallow lines; polite search bot via the sitemap; retrieval agent via the feed and by name).

## What this supports

The pipeline does what the code claims for the behaviours the personas exhibit: robots handling, alternates, manifests, assets, cookies, pacing, canary memory, and multi-address coordination each move the intended traits and land the intended class.

## Speculation

None. This is a self-consistency check, not an observation of the world.

## Caveats specific to this finding

- Fast mode compresses every pause to ≤ 20 ms, which is why `browser_human` wins by only 0.13 (its reading-like pauses are gone and the *too fast for a person* rule fires against it) and why the swarm's coverage signal stayed silent. A real-speed run (`--fast` omitted) should widen both.
- `retrieval_agent` won by 0.03 over `scripted_agent` because it also fetched an orphan page by name, which is scripted-agent behaviour. Heuristics v1 was tightened after this run: the scripted-agent *targeted* rule now requires fewer than two alternates, and retrieval gains a rule for sessions where alternates are both numerous (≥ 5) and a large share (≥ 30%) of requests. The table above is from before that change and is kept as the honest record; the shipped rules put `retrieval_agent` at a margin of about 0.4 on the same run, with every other persona unchanged.
- One run, one seed. The personas are deterministic; the timings are not.

## Reproduce

```bash
git checkout SGR-2026.09
SWARMGLASS_ENV=development npm run dev &
npm run synth -- --personas all --seed 1 --fast
# ~30 s later: console → synthetic
```
