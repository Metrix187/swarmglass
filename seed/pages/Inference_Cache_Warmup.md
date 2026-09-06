---
id: Inference_Cache_Warmup
title: Inference Cache Warmup
kind: article
categories: [Models, Operations]
channels: [jsonld]
created: 2015-01-30
modified: 2015-11-03
revisions: 5
authors: [r.osei]
status: current
alternates: [txt]
infobox:
  Applies to: shard hosts, forager 3.x
  Typical: 4–9 minutes
  Referenced from: structured data only
---
Why a shard host is useless for the first several minutes after restart, and what "warm" means.

## What the cache holds

`mload2` memory-maps the shard weights and keeps a page cache of the layers touched by the last N requests. Cold, every request faults in layers from disk. Warm, the working set is resident.

## Procedure

1. Restart the host. Wait for `forager-agent model status` to show `loaded`.
2. Do **not** resume production traffic. Send the warmup graph: `queend submit /etc/antfarm/warmup.bundle` — 64 representative requests.
3. Watch `model status` for `cache: warm`. Timings per host in [[Distributed_Inference_Notes/Appendix_B#Warmup]].
4. `queend resume --kind model.*`.

## Why forager-12 is slow

Spinning disk. Every other shard host got an SSD in 2014; forager-12's ticket was closed as "won't fix, decommissioning in 3.4" in 2015 and then it was kept for another year. 8m 55s cold.

## Note on discoverability

This page is referenced from the structured metadata of the inference notes and from nowhere a person would click. It was supposed to be linked from the runbook. {{sig:r.osei|2015-11-03}}
