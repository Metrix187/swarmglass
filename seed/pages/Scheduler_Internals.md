---
id: Scheduler_Internals
title: Scheduler Internals
kind: article
categories: [ANTFARM Core]
created: 2011-10-05
modified: 2015-06-16
revisions: 18
authors: [mkerrigan]
status: current
alternates: [txt, json]
infobox:
  Component: queend/sched
  Algorithm: cost-class round robin
  Introduced: 1.2, cost classes in 2.1
---
How the queen decides which forager gets which task-graph node. There is less here than you would hope.

## Loop

Every 250 ms:

1. Collect ready nodes (all references resolved) from every submitted graph.
2. Sort by `deadline` ascending, then submission order.
3. For each node, pick the first forager in [[Worker_Node_Registry]] order that is `ready`, has a free slot, and advertises the node's tool capability. `pin` overrides.
4. Send `task.assign`. Decrement the slot. Record the assignment with the current time.
5. Reissue anything past `assign_timeout`.

No load awareness beyond slots. `load` in the registry record is displayed and ignored.

## Cost classes

Since 2.1, each tool has a cost class from the [[Tool_Registry|manifest]]: `cpu`, `io`, `model`. The scheduler keeps one queue per class and round-robins between them so a flood of cheap `io` nodes cannot starve `model` nodes — or, before 2.1, the reverse, which is what actually happened and produced [[Known_Agent_Bugs#toolreg|AF-52]].

## Deadlines

A node past its deadline is *still assigned* (AF-80). Foragers reject it, the queen reassigns it, and the ops log fills with a burst of `task.reject`. Cancel the graph by hand.

## Reissue

Reissue after `assign_timeout` does not cancel the original. Two foragers may run the same node ([[Known_Agent_Bugs#Duplicate_execution|AF-44]]). The result that arrives second is dropped; its side effects are not.

## Epochs

Every assignment carries the queen's epoch. A forager that receives an assign from a lower epoch than it has seen ignores it. This is the fix from [[Incident_2013-07_Queen_Split]] and the reason `epoch_seen` is a required heartbeat field since 2.3.

## See also

- [[Task_Graph_Format#Attributes]]
- [[Configuration_Reference#queen]]
