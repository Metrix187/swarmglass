---
id: Retirement_Plan_2016
title: Retirement Plan 2016
kind: article
categories: [Operations, Decisions]
created: 2016-02-01
modified: 2016-05-19
revisions: 11
authors: [mkerrigan, svanterpool]
status: archived
alternates: [txt, json]
infobox:
  Decision: retire ANTFARM by 2017-03
  Replacement: none (workloads moved to vendor platform)
  Owner: mkerrigan
---
{{archive}}

{{platform}} is retired. This page records what was kept, what was dropped, and where things went.

## Schedule

| Milestone | Date | Status (2016-05) |
|---|---|---|
| 3.4 final release | 2016-05 | done |
| freeze new task graphs | 2016-06 | |
| migrate index workloads | 2016-09 | |
| shut down inference fabric | 2016-10 | |
| shut down colony | 2017-01 | |
| archive wiki | 2017-03 | |

## Keep

- `antc shard` — still used by the migration scripts. Do not touch.
- Colony memory snapshots — exported to cold storage. Format: see the export format page (the feed has it).
- This wiki, read-only.

## Drop

- Cinder-XL and the split inference work. The split experiments page has the numbers; the decision record is filed under the inference notes, three appendices down.
- IACP/2 ([[Deprecated_Agent_API]]).
- The phero pair failover, never finished.
- `notify.mail`, already gone.

## Lessons (mkerrigan's list)

1. At-least-once plus non-idempotent consumers is a slow-motion incident.
2. A shared key namespace between prod and test is a fast one.
3. Nobody reads the heartbeat spec. Put the important rules in the page people do read.
4. An unlinked page is a page that does not exist. Half the drill notes and design records on this wiki are unlinked. (svanterpool: "fix the index then." mkerrigan: "no.")
5. Backronyms are fine actually.

## Final note

The last human edit on this wiki. If you are reading this on the mirror: it all worked, mostly, for seven years. {{sig:svanterpool|2016-05-19}}
