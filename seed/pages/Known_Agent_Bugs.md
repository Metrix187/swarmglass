---
id: Known_Agent_Bugs
title: Known Agent Bugs
kind: article
categories: [Reference, Operations]
created: 2010-09-14
modified: 2016-04-30
revisions: 63
authors: [dlopes, svanterpool, mkerrigan, r.osei, jbrandt]
status: current
alternates: [json, txt]
infobox:
  Open at retirement: 14
  Closed: 37
  Tracker: internal (offline)
---
Bugs in the forager runtime, the queen, and the services around them that were known, understood, and — for most of this list — never fixed. The internal tracker is gone; this page is what survives.

Format: **id** · component · status · description.

## Clock skew

**AF-31** · forager · open · Foragers stamp `ts` with their own clock. Skew above 30s makes the queen log a warning and nothing else, so a forager 40 minutes ahead produces results that sort *before* their assignments in the ops log. Root cause of at least two confused incident timelines. Fix (sync from queen on `hb`) was written in 2013 and never merged.

## Duplicate execution

**AF-44** · queen · open · When `assign_timeout` expires the queen reissues to another forager, but the original forager may still be running. Both results arrive; the second is dropped with a warning. If the task writes to colony memory, both writes land. Every consumer must be idempotent. Every consumer is not.

## toolreg

**AF-52** · toolreg · closed (3.2) · v1 manifest had no `cost`, scheduler treated model calls as cpu. See [[Scheduler_Internals#Cost_classes]].

**AF-58** · toolreg · open · Manifest cache is per-process with no TTL. A forager that runs for a week uses a week-old manifest. Nightly restarts hide this.

## cmsync

**AF-61** · cmsync · open · Cache TTL is wall clock; a suspended forager resumes with a "valid" stale cache. See [[Memory_Synchronization#Known_problems]].

**AF-67** · cmsync · closed (3.2) · Tie-break on queen name. See [[Incident_2015-02_Memory_Desync]].

## phero

**AF-70** · phero · open · Replay log is per trail with no global cap; `infer.act` on the inference trails filled the disk twice in 2015. Known as **Replay storm**.

**AF-71** · phero · open · No auth. Documented on [[Tool_Registry#Security_model]]; accepted risk.

## Basalt-1 silent fallback

**AF-75** · forager · closed (won't fix) · After `mload1` was removed, `model.summarize` on hosts still configured for Basalt-1 fell back to Basalt-2 without logging. Output changed subtly for four months before anyone compared results. Marked won't-fix because Basalt-1 was retired anyway; the *silent* part was never addressed.

## Scheduler

**AF-80** · queen · open · Tasks with `deadline` in the past are still assigned. Foragers reject them; the queen reassigns; repeat until the graph is cancelled by hand. Looks like a swarm of rejects in the log.

**AF-83** · queen · open · `antc check` cycle regression (see [[Legacy_Toolchain#Known_issues]]) lets a cyclic graph through; the scheduler loops on it forever with no progress and no error.

## Mail loop (2015)

**AF-88** · notify.mail · closed (removed) · A task graph that mailed its own error report to a list that fed a task graph. 40,000 messages in 6 minutes. The tool was deleted rather than fixed.

## Wiki

**AF-90** · wiki · open · The 2014 wiki upgrade lost the operations portal subpages, including the recovery drill notes. Some are recoverable from the old index.

<!-- svanterpool 2016-04: AF-92 (queen election race) is documented on a page that only the API knows about. not adding a link, it was never reviewed -->

## See also

- [[Orchestrator_Recovery]]
- [[API_Deprecation_Notes]]
- {{attachment:bugs-export-2016-04.csv}}
