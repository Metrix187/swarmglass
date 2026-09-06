---
id: Agent_Message_Bus
title: Agent Message Bus
kind: article
categories: [ANTFARM Core, Protocols]
created: 2010-06-11
modified: 2014-11-30
revisions: 22
authors: [dlopes, mkerrigan]
status: current
alternates: [json, txt]
infobox:
  Service: phero
  Port: 7421
  Pattern: pub/sub over TCP
  Delivery: at-least-once
  Owner: dlopes
---
The **Agent Message Bus**, universally called the **phero bus** (from *pheromone*; the ant theme was dlopes's idea and nobody stopped him), carries every [[Internal_Agent_Communication_Protocol|IACP]] message in the colony. It is a small single-binary pub/sub broker written in 2010, replaced by nothing, and still running at retirement.

## Trails

A *trail* is a topic. Trails are hierarchical and separated by dots:

- `queen.*` — control plane. only the queen publishes here.
- `forager.<name>.*` — one namespace per worker.
- `tool.*` — [[Tool_Registry]] traffic.
- `mem.*` — [[Memory_Synchronization|cmsync]] traffic.
- `ops.*` — human-triggered messages from the ops console.

Subscriptions are prefix matches. A forager subscribes to `queen.assign.<name>` and `queen.ctl.*`; the queen subscribes to `forager.*`.

## Delivery guarantees

At-least-once within a trail, in publish order per publisher. The broker keeps a bounded replay log per trail (`trail_log_size`, default 10,000 messages). A subscriber that reconnects presents its last-seen sequence number and gets a replay. If the gap exceeds the log, the subscriber gets `ctl.resync` and must do a full [[Orchestrator_Recovery#Resync|resync]].

There is no exactly-once. Every consumer has to be idempotent, which is the single most repeated sentence on this wiki.

## Wire format

Framing and the exact byte layout are on [[Pheromone_Bus_Wire_Format]]. Short version: 4-byte length prefix, then the IACP JSON line. The 2.0 "binary framing" work never shipped.

## Operations

- Broker config: `/etc/antfarm/phero.conf` — see [[Configuration_Reference#phero]].
- Metrics: `http://phero-a.hm.internal:7421/stats` (plain text, one counter per line).
- The broker never had authentication. See the note on [[Tool_Registry#Security_model]].

## Migration history

The bus moved hosts twice: from `queen01` to a dedicated `phero-a` in 2012, and to a pair (`phero-a`/`phero-b`) in 2014 that never actually ran as a pair because the failover script was never finished. The 2014 checklist is still around and is mostly accurate.

<!-- dlopes 2014-11: checklist is at [[Message_Bus_Migration_Checklist]], not linking it from here until the failover section is fixed -->

## See also

- [[Pheromone_Bus_Wire_Format]]
- [[Internal_Agent_Communication_Protocol]]
- [[Known_Agent_Bugs#phero]]
