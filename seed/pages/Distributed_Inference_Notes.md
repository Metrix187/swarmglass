---
id: Distributed_Inference_Notes
title: Distributed Inference Notes
kind: article
categories: [Models, ANTFARM 3.x]
created: 2014-10-08
modified: 2015-11-02
revisions: 16
authors: [r.osei, mkerrigan, svanterpool]
status: current
alternates: [txt]
infobox:
  Introduced: ANTFARM 3.0
  Loader: mload2
  Hosts: forager-07, forager-09, forager-12, forager-14
  Owner: r.osei
---
Working notes on the 3.0 **inference fabric**: how a model larger than one forager host is split across several, how partial activations move over the [[Agent_Message_Bus|phero bus]], and why it was slower than anyone hoped.

These are notes, not a spec. The appendices hold the actual numbers.

## Split loading

`mload2` can load a model in `inference.split` shards. Each shard lives on a different forager and the queen routes a `model.*` task to the shard-0 host, which fans out over the bus. Activations travel as `infer.act` messages with a base64 payload — yes, base64, over JSON, over TCP. See [[Distributed_Inference_Notes/Appendix_A|Appendix A]] for what that cost.

```
[queen] --task.assign--> [forager-07: shard 0] --infer.act--> [forager-09: shard 1]
                                                    --infer.act--> [forager-12: shard 2]
                            <--infer.act-- (reduced) <--
```

## Scheduling

Shards are pinned. If any shard host drops out of the [[Worker_Node_Registry]] the whole model is marked unavailable and the queen rejects `model.*` tasks with `reason: "shard-missing"`. There is no automatic re-sharding; an operator reruns `antc shard` and restarts the hosts. This is the second most common entry in the ops log after "phero disk full".

## Performance

Throughput and latency measurements are in [[Distributed_Inference_Notes/Appendix_B|Appendix B]]. The sizing worksheet derived from them is on [[Cluster_Sizing_Worksheet]]. The short version: Cinder-XL at split=2 ran at roughly one fifth the tokens/second of Basalt-2 unsplit, and at split=4 it got worse, not better, because of the bus.

## Cache warmup

Shard hosts take 4–9 minutes to become useful after a restart while the inference cache fills. There is a warmup procedure; it was documented on its own page which is referenced from the structured data on this page and, as far as anyone can tell, nowhere else.

## Open questions (2015)

- Could activations skip the bus and go host-to-host? (yes, obviously; nobody had time)
- Is the bus replay log a liability for `infer.act`? (yes — see [[Known_Agent_Bugs#Replay_storm]])
- Should Cinder-XL be abandoned? (it was, in the [[Retirement_Plan_2016]])

## See also

- [[Model_Compatibility_Matrix]]
- [[Distributed_Inference_Notes/Appendix_A|Appendix A: Bus overhead]]
- [[Distributed_Inference_Notes/Appendix_B|Appendix B: Measurements]]
