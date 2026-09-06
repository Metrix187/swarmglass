---
id: Cinder_XL_Split_Experiments
title: Cinder-XL Split Experiments
kind: article
categories: [Models, ANTFARM 3.x]
created: 2015-03-12
modified: 2015-10-28
revisions: 8
authors: [r.osei]
status: draft
alternates: [txt]
infobox:
  Model: Cinder-XL (6B)
  Hosts: forager-07/09/12/14
  Outcome: abandoned
---
Notes from trying to make Cinder-XL run acceptably at split=4. It did not. This page is a draft that was never cleaned up.

## Placements tried

| Placement | shard 0 | shard 1 | shard 2 | shard 3 | tok/s |
|---|---|---|---|---|---|
| P1 (default) | forager-07 | forager-09 | forager-12 | forager-14 | 52 |
| P2 | forager-07 | forager-12 | forager-09 | forager-14 | 49 |
| P3 (12 last) | forager-07 | forager-09 | forager-14 | forager-12 | 55 |
| P4 (2 hosts, 2 shards each) | forager-07 | forager-07 | forager-09 | forager-09 | 61 |

P4 is the interesting one: two shards per host halves the bus hops. It also halves the memory headroom, which is why forager-07 OOM'd twice during the run.

## Trail sizes

`trail_log_size` for the `infer.*` trails: 10000 (default) → 500 → 50. Below 50 the replay stopped covering a single forward pass and shards desynced. 50 is what shipped in 3.2.

## Why it got worse

Each extra split adds a bus round-trip per layer boundary, and each round-trip is encode + publish + replay-log write + subscribe delivery + decode. At split=4 the bus is busy ≈ 70% of wall time. The maths is in [[Distributed_Inference_Notes/Appendix_A]].

## What would have fixed it

Direct transfer. Also, honestly, a smaller model. The final appendix — [[Distributed_Inference_Notes/Appendix_C]] — has the decision record and the recommendation to stop.

{{sig:r.osei|2015-10-28}}
