---
id: Cluster_Sizing_Worksheet
title: Cluster Sizing Worksheet
kind: article
categories: [Operations, Models]
created: 2015-04-01
modified: 2015-11-05
revisions: 6
authors: [svanterpool, r.osei]
status: current
alternates: [txt, yaml]
infobox:
  Purpose: estimate forager count for a workload
  Inputs: tasks/hour, model share, split
---
A back-of-envelope worksheet for deciding how many foragers a workload needs. Derived from [[Distributed_Inference_Notes/Appendix_B]] numbers; do not use it for anything that matters without re-measuring.

## Inputs

| Symbol | Meaning | Typical |
|---|---|---|
| T | tasks per hour | 2,000 |
| m | fraction of tasks that call a model | 0.15 |
| t_c | mean cpu/io task seconds | 4 |
| t_m | mean model task seconds (Basalt-2, split=1) | 9 |
| s | slots per forager | 2 |
| u | target utilisation | 0.6 |

## Formula

```
busy_seconds_per_hour = T * ((1 - m) * t_c + m * t_m)
foragers_needed       = busy_seconds_per_hour / (3600 * s * u)
```

With the typical column: 2000 × (0.85 × 4 + 0.15 × 9) = 9,500 s/h → 9,500 / (3600 × 2 × 0.6) ≈ 2.2 foragers. The colony ran eleven. The extra capacity was for the index rebuilds, not steady state.

## Model share sensitivity

| m | foragers |
|---|---|
| 0.05 | 2.0 |
| 0.15 | 2.2 |
| 0.40 | 2.8 |
| 0.80 | 3.7 |

## Caveats

- Ignores warmup, which dominates after any shard restart.
- Ignores the bus, which dominates at split ≥ 2.
- Assumes `assign_timeout` never fires. It fires.

{{sig:svanterpool|2015-11-05}}
