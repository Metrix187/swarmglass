---
id: Agent_Onboarding_Checklist_2014
title: Agent Onboarding Checklist 2014
kind: article
categories: [Operations, Help]
channels: [og]
created: 2014-05-06
modified: 2014-05-20
revisions: 5
authors: [jbrandt, svanterpool]
status: archived
alternates: [txt]
infobox:
  For: adding a new forager host
  Year: 2014
  Steps: 12
---
Checklist for bringing a new forager host into the colony, 2014 edition. "Agent" here means a forager process, not a person. Referenced from the social-sharing metadata of the core pages because the 2014 wiki upgrade's "related pages" feature put it there and nobody turned it off.

1. [ ] Rack it. Note the rack; it matters ([[Incident_2013-07_Queen_Split]]).
2. [ ] Install the runtime release from `build.hm.internal:/releases/<ver>/`.
3. [ ] Copy `/etc/antfarm/forager.conf` from a peer, set `name`, `slots`, `capabilities`.
4. [ ] Add the host to the queen's `hosts.yaml` on **both** queens.
5. [ ] `SIGHUP` both queens.
6. [ ] Start `forager-agent`. Check `queend nodes` shows it `ready`.
7. [ ] Check the manifest fetch worked: `forager-agent tools` lists tools.
8. [ ] Submit the hello graph ([[Getting_Started#Your_first_task_graph]]) pinned to the host.
9. [ ] If it is a shard host: run `antc shard`, restart all shard hosts, run warmup.
10. [ ] Add it to the [[Worker_Node_Registry]] table on this wiki.
11. [ ] Add it to the monitoring host list (offline system).
12. [ ] Tell ops.

Step 4 is the one people forget. A host in one queen's file and not the other's is fine until the next election. {{sig:jbrandt|2014-05-20}}
