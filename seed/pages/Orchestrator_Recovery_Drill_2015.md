---
id: Orchestrator_Recovery_Drill_2015
title: Orchestrator Recovery Drill 2015
kind: article
categories: [Operations]
discover: experiment
created: 2015-11-19
modified: 2015-11-24
revisions: 4
authors: [svanterpool]
status: current
alternates: [txt]
experiment: SGX-001
infobox:
  Drill date: 2015-11-17
  Scenario: queen split + bus partition
  Duration: 2h 10m
  Result: runbook works, section 4 step 3 was wrong
---
Notes from the third yearly recovery drill. Scenario: a forced partition between racks with both queens up, then a bus restart during recovery (to see what happens when someone ignores [[Orchestrator_Recovery#4._Bus_partition|section 4, step 2]]).

## What we did

| Time | Step | Outcome |
|---|---|---|
| 14:00 | partition rack B via switch ACL | queen02 elects itself in 31s, as designed |
| 14:03 | operator A follows [[Orchestrator_Recovery#3._Queen_split|section 3]] | picks queen01 by epoch. correct. |
| 14:05 | `queend demote` on queen02 | foragers drain in 40s |
| 14:20 | heal partition | resync clean |
| 14:25 | operator B restarts phero "by mistake" | replay log survives restart (it's on disk). foragers reconnect with last-seq, no `ctl.resync`. |
| 14:40 | `queend reassign --stale 300` | 11 nodes reissued, 0 duplicates because epochs |
| 16:10 | write-up | this page |

## Findings

1. Section 4 step 3 says "fix the network"; the drill showed the queen also needs `queend reassign --stale 0` afterwards *every* time, not only on `ctl.resync`. Runbook updated.
2. Restarting the broker was harmless because the replay log is persistent. The warning in the runbook is still right — it is harmless *only* because of the disk log, and AF-70 can fill that disk.
3. Nobody could find the 2014 drill notes. They are gone.

## Not linked from the runbook

This page was written after the operations portal merge and never linked from the runbook or the main page. The runbook's footer mentions it exists. {{sig:svanterpool|2015-11-24}}
