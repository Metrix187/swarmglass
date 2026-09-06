---
id: Incident_2013-07_Queen_Split
title: Incident 2013-07: Queen Split
kind: article
categories: [Incidents, Operations]
created: 2013-07-19
modified: 2013-11-22
revisions: 13
authors: [svanterpool, mkerrigan]
status: archived
alternates: [txt]
infobox:
  Date: 2013-07-16 to 2013-07-17
  Duration: 19 hours
  Impact: duplicated and dropped tasks
  Root cause: partition + no epochs
---
{{archive}}

## Summary

A 40-minute network partition between the queen hosts on 2013-07-16 left both queens believing they led. Foragers on each side of the partition followed a different queen; when the partition healed, foragers switched allegiance on every heartbeat for nineteen hours. Roughly 3,100 task nodes ran twice and 600 results were dropped.

## Timeline (UTC)

| Time | Event |
|---|---|
| 07-16 14:02 | switch firmware upgrade partitions rack B (queen02, forager-03, -06, -08) |
| 14:03 | queen02 misses 3 heartbeats from queen01, elects itself |
| 14:04 | foragers on rack B start accepting assigns from queen02 |
| 14:41 | partition heals. both queens see all foragers. |
| 14:41–next day 09:20 | foragers accept assigns from whichever queen spoke last. duplicate execution and dropped results. |
| 07-17 08:50 | svanterpool notices `index/latest` written 2,200 times |
| 09:05 | first recovery attempt: restart queen02. queen02 comes back, elects itself again. |
| 09:12 | second recovery attempt by mkerrigan, simultaneously: restart queen01. now both restarting. |
| 09:20 | both up, queen01 wins the tie by name. stable. |

## Root cause

No notion of leadership epoch. A forager had no way to know that an assign from queen02 was stale once queen01 was back. The fix (epochs, `epoch_seen` in heartbeats, ignore lower-epoch assigns) shipped in 2.3 — see [[Scheduler_Internals#Epochs]].

## Contributing factors

- Two people recovering at once (09:05 / 09:12). Now rule 3 in [[Orchestrator_Recovery#2._Before_touching_anything]].
- "Pick the queen with more foragers" was the instinct and would have picked queen02 (rack B had more hosts that day). The runbook now says higher epoch, then queen01.
- No alert on duplicate memory writes. There still isn't one.

## Remediation

1. Epochs (2.3).
2. Runbook section 3.
3. Yearly recovery drill, starting 2013-11. Drill notes for 2013 were never written; 2015's exist.

{{sig:svanterpool|2013-11-22}}
