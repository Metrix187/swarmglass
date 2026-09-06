---
id: Queen_Election_Protocol
title: Queen Election Protocol
kind: article
categories: [Protocols, ANTFARM Core]
channels: [api]
created: 2013-10-21
modified: 2016-04-29
revisions: 8
authors: [mkerrigan, svanterpool]
status: draft
alternates: [json, txt]
infobox:
  Component: queend
  Since: 2.3
  Status: draft — never reviewed
---
How the two queens decide who leads. Written in 2013, never reviewed, never linked; it is listed by the wiki's page API because the API lists everything. The [[Known_Agent_Bugs]] page refers to it obliquely (AF-92).

## Protocol

1. Each queen holds an `epoch` in `epoch_file`.
2. A queen that has not heard a peer heartbeat for `hb_miss_evict × hb_interval` (30 s) starts an election: increments its epoch, writes it, and broadcasts `queen.elect` on the bus with the new epoch.
3. Any queen receiving `queen.elect` with a higher epoch than its own becomes follower and adopts the epoch.
4. Equal epochs: lexically smaller name wins (`queen01`). This is the opposite direction from the cmsync tie-break, which nobody noticed until 2015.
5. `election_min_ms` (1500) is a random back-off window before step 2 so both queens do not elect simultaneously. It is not random; it is a fixed 1500 ms on both hosts.

## AF-92: the race

Because step 5 is fixed, a symmetric partition makes both queens elect at the same moment with the same new epoch, and step 4 resolves it — but only after both have already broadcast `queen.elect`, so foragers see two elections and `SPLIT?` fires ([[Node_Heartbeat_Spec#Rules|heartbeat rule 5]]). Harmless in practice; alarming in the logs. Fix: actually randomise the back-off. Never done.

## Draft status

This page was meant to be reviewed by dlopes in 2013 and folded into [[Scheduler_Internals]]. {{sig:mkerrigan|2013-10-21}}

<div class="small">2016-04-29: still a draft. Leaving it for the archive. {{sig:svanterpool|2016-04-29}}</div>
