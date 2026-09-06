---
id: Colony_Glossary
title: Colony Glossary
kind: article
categories: [Reference]
created: 2010-06-30
modified: 2015-07-07
revisions: 28
authors: [dlopes, mkerrigan, jbrandt]
status: current
alternates: [json, txt]
infobox:
  Terms: 24
  Theme: ants (blame dlopes)
---
Vocabulary used across the {{platform}} documentation. The ant metaphor was a joke in the first design review that stuck because every alternative was worse.

; **Colony** : one deployment of {{platform}}: queens, foragers, bus, memory. HSC ran one production colony and one test colony (`queen02`).
; **Queen** : the orchestrator process, `queend`. Assigns work, owns the [[Worker_Node_Registry|node registry]], applies memory writes. Two queen hosts, one leader.
; **Forager** : a worker agent process, `forager-agent`. Executes task-graph nodes by calling tools.
; **Trail** : a pub/sub topic on the [[Agent_Message_Bus|phero bus]].
; **Phero** : the message bus. From *pheromone*.
; **Colony memory** : the shared key/value store, `cm://` keys. See [[Memory_Synchronization]].
; **cmsync** : the memory synchronisation service between queens.
; **toolreg** : the [[Tool_Registry]].
; **Manifest** : the list of tools toolreg serves to a forager.
; **Task graph** : a DAG of tool calls in a `.tg` file. See [[Task_Graph_Format]].
; **Bundle** : a compiled task graph, output of `antc build`.
; **Node** : one vertex of a task graph, the unit of assignment.
; **Assign** : the queen giving a node to a forager (`task.assign`).
; **Epoch** : the queen's leadership counter. Increases on every election. Foragers track `epoch_seen`.
; **Split** : two queens both believing they lead. See [[Incident_2013-07_Queen_Split]].
; **Desync** : colony memory disagreeing between queens. See [[Incident_2015-02_Memory_Desync]].
; **Drain** : `ctl.drain`, finish current work and take no more.
; **Halt** : `ctl.halt`, stop now.
; **Resync** : a forager rebuilding its view of the bus and memory after a gap.
; **Shard** : one piece of a split model in the [[Distributed_Inference_Notes|inference fabric]].
; **Warmup** : the period after a shard host restarts before its inference cache is useful.
; **Slot** : concurrent task capacity of a forager.
; **Stamp** : the vector clock on a colony memory value.
; **Replay log** : the bus's per-trail buffer that lets subscribers catch up.

Missing a term? It used to be fine to add it here. It is not anymore; the mirror is read-only.

## See also

- [[Getting_Started]]
- [[Internal_Agent_Communication_Protocol]]
