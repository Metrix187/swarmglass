# Reproducibility

Every published Swarmglass number is a function of four inputs. This document says how to get from those inputs back to the number, and how someone without our telemetry can still check the pipeline.

## The four inputs

| input | where it is stamped |
|---|---|
| experiment definition (id + version) | bundle, report `summary.json`, `experiment_runs` table |
| seed version (`seed/VERSION`) | every page's JSON alternate, `/api/v1/status`, bundle, report, canaries table |
| heuristics version (`config/heuristics.json`) | bundle, report, `experiment_runs` |
| database window (`since`, `until`) | bundle `provenance.range`, report `summary.json.range` |

## Re-deriving a published table (with access to the instance)

```bash
# 1. check out the release that produced it
git checkout SGR-2026.09          # research release tag = code + seed + heuristics + definitions at publication

# 2. confirm versions match the publication
cat seed/VERSION; node -e "console.log(require('./config/heuristics.json').version)"

# 3. regenerate the comparison for the same window
npm run bundle -- --experiment SGX-001 --range 30d --level public
#    or, for an exact window, use the console: /api/experiments/SGX-001?range=…  (the api accepts h/d/m ranges;
#    for an arbitrary since/until run the query in docs/QUERIES.md §experiment arms)

# 4. compare sha256 of the comparison object
```

If the events for the window are still within retention, the numbers are identical: features are recomputed from events, scores from features, comparisons from scores and discoveries. After retention, the sanitized `sessions.jsonl` / `events.jsonl` shipped with the release are the record; they carry features and scores per session and the per-event fields needed to recompute reach and time-to-target (`page_id`, `rel_ms`, `status`).

## Re-deriving without our telemetry (anyone)

The *pipeline* is reproducible by anyone; the *observations* are ours. To check that the pipeline does what the paper says:

```bash
git clone … && npm install
SWARMGLASS_ENV=development npm run dev &
npm run synth -- --personas all --seed 1        # deterministic personas, deterministic choices
# wait ~30s for scoring, then:
curl -s -c c.txt -d 'user=researcher&password=swarmglass-dev' http://localhost:8081/login >/dev/null
curl -s -b c.txt 'http://localhost:8081/api/synthetic' | jq .confusion
```

The confusion matrix (persona × likely class) should match the one in `docs/findings/F-000-pipeline-validation.md` for the same heuristics version. Same seed, same personas, same rules → same labels.

## Determinism guarantees

- **Canaries**: `HMAC(secret, scope|key|placement|seedVersion)[:6]`. Same secret + seed → same ids. A canary is attributable only by the instance that issued it; publications refer to canaries by id and placement, never by secret.
- **Arms**: `fnv1a(salt|id|version|actorHash)`. Stable per actor for the life of a definition version.
- **Revision histories, recent changes, random page**: seeded from the seed version and page id (random page by wall-clock second, deliberately).
- **Synthetic personas**: seeded PRNG; `--seed N` reproduces the same request sequence (timing aside).
- **Scoring**: pure function of events + heuristics file. `npm run rescore` after any change.

## What is *not* reproducible, and is said so

- Which visitors arrive. Observations are a sample of whatever the internet sent that window.
- Session boundaries under adversarial clients (cookie churn, address rotation). The features carry that fragmentation; the limitations document discusses it.
- Anything about the identity of a visitor. The instrument does not produce it, so nothing to reproduce.

## Release tagging

A research release `SGR-YYYY.MM` is a git tag on the commit whose seed, heuristics and experiment definitions produced the published material, plus a folder under `research/releases/` listing the findings, datasets and their checksums. Never rewrite a release tag; publish a new one.
