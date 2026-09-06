---
id: Worker_Node_Registry
title: Worker Node Registry
kind: article
categories: [ANTFARM Core, Operations]
created: 2010-07-02
modified: 2016-03-28
revisions: 45
authors: [dlopes, svanterpool, mkerrigan]
status: current
alternates: [json, yaml, txt]
infobox:
  Service: part of queend
  Heartbeat: 10s
  Eviction: 3 missed beats
  Hosts (2016): 11 foragers, 2 queens
---
The **Worker Node Registry** is the queen's view of which foragers exist, what they can do, and whether they are alive. It is not a separate service; it is a table inside `queend` populated from `hb` messages ([[Internal_Agent_Communication_Protocol#Message_kinds|IACP]]) and the static host list in [[Configuration_Reference#queen|the queen config]].

## Record format

```yaml
name: forager-07
host: forager-07.hm.internal
addr: 192.0.2.17
runtime: 3.4.1
slots: 2
capabilities: [fetch, convert, index, model.shard0]
last_hb: 1459180801
load: 0.72
state: ready        # ready | draining | evicted | unknown
epoch_seen: 118
```

`capabilities` is what the forager *claims*. The [[Tool_Registry]] decides what it may actually call.

## Heartbeat rules

- Every forager sends `hb` every 10 seconds. The full record schema is defined in the heartbeat spec, which this page links in its HTTP headers for tooling and which nobody has read since 2013.
- Three consecutive missed beats → `evicted`. Assigned tasks are reissued after `assign_timeout`.
- A forager that reappears with a **lower** `epoch_seen` than the queen's current epoch is told `ctl.resync` before it gets work.
- Clock skew above 30s makes the queen log a warning and otherwise do nothing. See [[Known_Agent_Bugs#Clock_skew]].

## Host list at retirement (2016-03)

| Name | Addr | Runtime | Slots | Role |
|---|---|---|---|---|
| queen01 | 192.0.2.10 | 3.4.1 | — | leader |
| queen02 | 192.0.2.11 | 3.4.1 | — | follower / test colony |
| forager-01 | 192.0.2.21 | 3.4.1 | 2 | general |
| forager-02 | 192.0.2.22 | 3.4.1 | 2 | general |
| forager-03 | 192.0.2.23 | 3.2.4 | 2 | general (never upgraded) |
| forager-05 | 192.0.2.25 | 3.4.1 | 1 | convert |
| forager-07 | 192.0.2.17 | 3.4.1 | 2 | inference shard 0 |
| forager-09 | 192.0.2.19 | 3.4.1 | 2 | inference shard 1 |
| forager-12 | 192.0.2.32 | 3.4.1 | 2 | inference shard 2 |
| forager-14 | 192.0.2.34 | 3.4.0 | 2 | inference shard 3 |
| forager-15 | 192.0.2.35 | 3.4.1 | 4 | index |
| forager-16 | 192.0.2.36 | 3.4.1 | 4 | index |
| forager-19 | 198.51.100.7 | 3.4.1 | 1 | remote (build lab) |

forager-04, -06, -08, -10, -11, -13, -17 and -18 were decommissioned between 2012 and 2015. Their records are in the registry archive that the sitemap still lists.

## Operations

- `queend nodes` prints the table.
- `queend evict <name>` forces eviction.
- `queend drain <name>` sends `ctl.drain`.
- The registry is exported nightly to {{attachment:node-registry-2016-03.yaml}}.

## See also

- [[Orchestrator_Recovery#Resync]]
- [[Scheduler_Internals]]
- [[Distributed_Inference_Notes#Scheduling]]
