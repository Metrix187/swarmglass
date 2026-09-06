---
id: Distributed_Inference_Notes/Appendix_C
title: Distributed Inference Notes/Appendix C
kind: article
categories: [Models, ANTFARM 3.x, Decisions]
created: 2015-11-04
modified: 2015-11-20
revisions: 5
authors: [r.osei, mkerrigan]
status: current
alternates: [txt, json]
experiment: SGX-005
infobox:
  Parent: Distributed Inference Notes
  Topic: decision record — stop Cinder-XL
  Decision date: 2015-11-18
---
**Appendix C: Decision record.** Whether to continue the distributed inference work for Cinder-XL. Five links deep from the main page, which is roughly how much anyone wanted to find it.

## Decision

Stop. Cinder-XL is removed from the production roadmap. The inference fabric stays for Basalt-2 at split=1 and split=2 (the latter only for the two hosts with less memory).

## Reasoning

1. Best measured throughput at split=2 is 88 tok/s ([[Distributed_Inference_Notes/Appendix_B]]), one fifth of Basalt-2, for a model that is not five times better on the internal eval set.
2. Every split configuration puts the [[Agent_Message_Bus|phero bus]] on the critical path, and the bus has an unbounded replay log ([[Known_Agent_Bugs#phero|AF-70]]).
3. The direct-transfer fix is two weeks of work nobody has, on a platform with a [[Retirement_Plan_2016|retirement plan]].
4. The [[Cinder_XL_Split_Experiments|split experiments]] found no placement that changed the conclusion.

## Consequences

- `model.summarize` stays on Basalt-2.
- forager-12 and forager-14 are freed from shard duty in 3.4 and go back to the general pool.
- The `[inference]` config section keeps `split` for Basalt-2 only.

## Dissent

mkerrigan noted that the two-week estimate was probably right and that this would have been the first time. Recorded, overruled by the calendar.

{{sig:r.osei|2015-11-20}}
