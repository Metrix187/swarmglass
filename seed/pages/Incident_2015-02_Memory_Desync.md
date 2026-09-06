---
id: Incident_2015-02_Memory_Desync
title: Incident 2015-02: Memory Desync
kind: article
categories: [Incidents, Operations, Storage]
created: 2015-02-25
modified: 2015-08-20
revisions: 17
authors: [svanterpool, mkerrigan, jbrandt]
status: archived
alternates: [txt]
infobox:
  Date: 2015-02-19 to 2015-02-22
  Duration: 3 days
  Impact: silently wrong model config, stale index
  Root cause: tie-break on queen name + clock skew
---
{{archive}}

## Summary

For three days colony memory keys written on both queens resolved in favour of `queen02`, whose clock was 41 seconds ahead. Because `queen02` was the test colony, its writes included a test model config; `model.summarize` in production ran with it for the duration. Nobody noticed until inference measurements ([[Distributed_Inference_Notes/Appendix_B|Appendix B]], runs 020–021 in the raw tables) came out wrong.

## Timeline (UTC)

| Time | Event |
|---|---|
| 02-19 01:10 | ntp on queen02 stops syncing (disk full, log partition). clock drifts. |
| 02-19 22:00 | queen02 runs the nightly test graph, which writes `cm://model/conf/active` on the test colony. cmsync gossips it to queen01, because the key namespace was shared. |
| 02-19 22:00 | queen01's copy loses the tie: stamps concurrent, wall clock favours queen02 (41s ahead). |
| 02-20 to 02-22 | production foragers read the test config on cache expiry. Summaries get shorter and stranger. |
| 02-22 15:30 | r.osei's measurement run produces numbers 30% off. Investigates. Finds the config hash mismatch. |
| 02-22 16:10 | svanterpool runs `cmsync diff`, sees 412 keys preferring queen02. |
| 02-22 17:00 | resolved with `cmsync resolve --prefer queen01`. |

## Root cause

Two rules combined: last-writer-wins by wall clock, and shared key namespace between the production and test colonies. Either alone would have been fine.

## Remediation

1. Tie-break changed to prefer the *leader* queen, then epoch, never wall clock (3.2, [[Known_Agent_Bugs#cmsync|AF-67]]).
2. Test colony gets its own key prefix `cm://test/`. Enforced by config, not by code.
3. Clock skew between queens > 5 s now refuses sync (`cmsync` logs and pauses). This produced a new failure mode in April 2015 when both clocks were fine and the log partition filled again.
4. The desync test harness jbrandt wrote lives on [[Talk:Memory_Synchronization]] because nobody agreed where else to put it.

## Remediation (runbook form)

This is [[Orchestrator_Recovery#5._Memory_cmsync_desync|section 5 of the recovery runbook]].

{{sig:svanterpool|2015-08-20}}
