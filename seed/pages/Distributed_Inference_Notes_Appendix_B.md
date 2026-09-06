---
id: Distributed_Inference_Notes/Appendix_B
title: Distributed Inference Notes/Appendix B
kind: article
categories: [Models, ANTFARM 3.x]
created: 2014-12-02
modified: 2015-11-02
revisions: 9
authors: [r.osei, svanterpool]
status: current
alternates: [txt]
infobox:
  Parent: Distributed Inference Notes
  Topic: throughput and latency measurements
---
**Appendix B: Measurements.** Summary tables. The raw per-run numbers are on [[Raw_Measurement_Tables_2015]].

## Throughput (tokens/second, batch 8)

| Model | split | forager 3.0 | forager 3.2 | forager 3.4 |
|---|---|---|---|---|
| Basalt-2 | 1 | 412 | 438 | 441 |
| Basalt-2 | 2 | 190 | 205 | 211 |
| Cinder-XL | 2 | 71 | 84 | 88 |
| Cinder-XL | 4 | 52 | 58 | 60 |

Cinder-XL at split=4 is slower than split=2. Bus overhead ([[Distributed_Inference_Notes/Appendix_A|Appendix A]]) exceeds the compute win.

## Latency (p50 / p95, ms, single request)

| Model | split | p50 | p95 |
|---|---|---|---|
| Basalt-2 | 1 | 240 | 610 |
| Basalt-2 | 2 | 530 | 1,900 |
| Cinder-XL | 2 | 1,410 | 4,200 |
| Cinder-XL | 4 | 1,980 | 7,100 |

p95 for split configurations is dominated by bus replay hiccups, not compute.

## Warmup

| Host | Cold start to steady state |
|---|---|
| forager-07 (shard 0) | 4m 10s |
| forager-09 | 6m 40s |
| forager-12 | 8m 55s |
| forager-14 | 5m 20s |

The warmup procedure and why forager-12 is slow are in the cache warmup notes.

## Methodology

All runs on the production colony during the 02:00–04:00 maintenance window, three runs each, median reported. Config hashes are in the raw tables. The runs marked ⚠ there were repeated after the [[Incident_2015-02_Memory_Desync|desync incident]] because colony memory disagreed about which model config was live.

{{sig:r.osei|2015-11-02}}
