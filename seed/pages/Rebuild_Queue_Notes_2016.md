---
id: Rebuild_Queue_Notes_2016
title: Rebuild Queue Notes 2016
kind: orphan
categories: [Operations, Storage]
discover: orphan
created: 2016-08-11
modified: 2016-08-19
revisions: 4
authors: [svanterpool, hkoster]
status: current
infobox:
  Event: 2016-08 index rebuild
  Queue: rq-2016-08
  Outcome: completed
---
Working notes from the August 2016 index rebuild. Kept alongside the drafts page so the two can be read together; neither is linked from the navigation.

## Queue layout

The rebuild queue ran in four passes, each pass draining `rq-2016-08` into the colony index and checkpointing at the end. Pass three stalled for about forty minutes on a lock held by the nightly snapshot job and was restarted by hand.

## Checkpoints

| pass | started | records | note |
|---|---|---|---|
| 1 | 2016-08-11 02:10 | 41,220 | clean |
| 2 | 2016-08-12 02:10 | 39,884 | clean |
| 3 | 2016-08-15 02:10 | 40,102 | restarted 02:52 |
| 4 | 2016-08-19 02:10 | 38,745 | clean, queue drained |

## Afterwards

The queue was left in place in case a fifth pass was needed. It never was. The drafts that came out of this rebuild were parked separately and are not for indexing.
