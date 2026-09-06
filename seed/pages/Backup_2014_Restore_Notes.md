---
id: Backup_2014_Restore_Notes
title: Backup 2014 Restore Notes
kind: orphan
categories: [Operations, Storage]
discover: orphan
created: 2014-04-17
modified: 2014-04-18
revisions: 3
authors: [svanterpool]
status: current
alternates: [txt]
infobox:
  Event: 2014-04 colony memory restore
  Snapshot: cm-2014-04-15.snap
  Outcome: partial
---
Notes from restoring colony memory from the 2014-04-15 snapshot after the queen01 disk failure. This page is not linked from anywhere; it was written in a hurry and never filed. If you found it, you either guessed the title or you have the old index.

## What happened

queen01's `/var/lib` disk failed on 2014-04-16. queen02 took over cleanly (epochs worked). Colony memory on queen02 was complete, so a restore should not have been needed — except that queen02 had been running the test colony for a week and its memory had test keys mixed in.

## What we did

1. Rebuilt queen01, installed 2.3.4.
2. `cmsync restore --from cm-2014-04-15.snap --into queen01`.
3. Brought queen01 up as follower. cmsync full resync from queen02 **overwrote most of the restore** because queen02's stamps were newer. Expected in hindsight; see the export format page's warning about stamps.
4. Deleted test keys from queen02 by hand (`cm://test/*` did not exist yet as a prefix — that came in 2015).

## Lessons

- A restore onto a follower is pointless; the leader wins the resync.
- Restore onto an *isolated* queen, then promote it, then let the other resync from it.
- Prefix test keys. (Done, after the [[Incident_2015-02_Memory_Desync|2015 incident]] forced it.)

{{sig:svanterpool|2014-04-18}}
