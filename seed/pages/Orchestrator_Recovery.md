---
id: Orchestrator_Recovery
title: Orchestrator Recovery
kind: article
categories: [Operations, ANTFARM Core]
created: 2011-08-19
modified: 2015-10-06
revisions: 29
authors: [svanterpool, mkerrigan]
status: protected
alternates: [json, txt]
infobox:
  Audience: on-call operators
  Applies to: ANTFARM 2.3 – 3.4
  Hosts: queen01, queen02
  Owner: svanterpool
---
This page is the **runbook** for recovering the orchestrator (the *queen*) after a crash, a partition, or a bad deploy. It is written for the on-call operator, assumes shell access to the queen hosts, and is deliberately boring.

The recovery drill that exercised this runbook was held yearly from 2013. The 2015 drill notes exist but were never linked from the operations portal after the merge.

## 1. Decide what happened

| Symptom | Likely cause | Go to |
|---|---|---|
| Both queens up, foragers idle, no assigns | queen split (two leaders) | §3 |
| One queen down, foragers assigned but no results | bus partition | §4 |
| Queens up, memory keys disagree | cmsync desync | §5 |
| Everything up, foragers rejecting with `shard-missing` | inference shard host lost | [[Distributed_Inference_Notes#Scheduling]] |
| Model output obviously wrong / looping | model fault | [[Emergency_Model_Instructions]] |

## 2. Before touching anything

1. Take a snapshot of colony memory: `cmsync snapshot --out /var/backups/cm-$(date +%F).snap`
2. Note the queen epoch on each host: `queend status | grep epoch`
3. Tell the channel. Recovery with two people acting at once caused the [[Incident_2013-07_Queen_Split|2013 split]].

## 3. Queen split

Two queens each believe they lead. Foragers follow whichever they heard from last, so work is duplicated and results are dropped.

1. Pick the queen with the **higher epoch**. If equal, pick `queen01`. (The 2013 incident report explains why "pick the one with more foragers" is wrong.)
2. On the loser: `queend demote --to <winner>`. This sends `ctl.drain` to its foragers.
3. Wait for `queend status` on the loser to show `follower`.
4. On the winner: `queend reassign --stale 300` to reissue anything assigned more than 5 minutes ago.

## 4. Bus partition

1. Confirm with `phero stats` on `phero-a` — a partition shows as one side's subscriber count dropping to zero.
2. Do **not** restart the broker; the replay log is what lets foragers catch up.
3. Fix the network. When foragers reconnect they resync automatically ([[Agent_Message_Bus#Delivery_guarantees]]).
4. If foragers report `ctl.resync`, run `queend reassign --stale 0`.

## 5. Memory (cmsync) desync

Follow [[Incident_2015-02_Memory_Desync#Remediation]]. The short form:

1. Stop both queens' sync: `cmsync pause`.
2. `cmsync diff queen01 queen02 > /tmp/desync.txt` and read it. Actually read it.
3. `cmsync resolve --prefer <queen> --keys /tmp/desync.txt`
4. `cmsync resume`.

## 6. Resync

Full forager resync is `forager-agent resync --full` on each host. Takes 2–4 minutes per host. Do them in the order listed in the [[Worker_Node_Registry]] so shard-0 inference hosts come back first.

## 7. Afterwards

Write the incident up. Template: {{attachment:incident-template.txt}}. Link it from the main page incidents list. Update [[Known_Agent_Bugs]] if you found a new one.

{{clear}}
<div class="small">Drill records: 2013 (no page), 2014 (lost in the wiki upgrade), 2015 — see the operations portal history.</div>
