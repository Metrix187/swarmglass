# F-NNN — Title as a plain statement of what was observed

*Status: draft | published in SGR-YYYY.MM · Experiment: SGX-NNN vN (or "observational") · Seed: YYYY.MM.N · Heuristics: vN · Window: YYYY-MM-DD → YYYY-MM-DD · Report: `reports/<folder>` · Bundle sha256: …*

## Question

One sentence. What the experiment or observation was designed to tell us.

## Setup

What was varied, for whom, how arms were assigned, what counts as the outcome. Link the definition file. Say what was *not* varied.

## What we observed

The numbers, with intervals, and the charts from the report folder. Behavioural statements only: requests, orders, timings, headers, canaries.

| arm | sessions | actors | outcome |
|---|---|---|---|

## What this supports

Claims the data can carry, stated at the resolution the data has (sessions, actors, classes as defined in `config/heuristics.json`).

## Speculation

Anything about *why*, about what kind of system might behave this way, or about mechanisms. Clearly fenced here and nowhere else.

## Caveats specific to this finding

Session fragmentation, small n, a proxy change mid-window, a heuristics bump — whatever applies. General limitations live in `docs/LIMITATIONS.md` and are not repeated.

## Reproduce

```bash
git checkout SGR-YYYY.MM
npm run bundle -- --experiment SGX-NNN --range …
```
