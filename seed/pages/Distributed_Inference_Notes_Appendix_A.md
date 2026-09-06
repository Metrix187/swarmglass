---
id: Distributed_Inference_Notes/Appendix_A
title: Distributed Inference Notes/Appendix A
kind: article
categories: [Models, ANTFARM 3.x]
created: 2014-11-12
modified: 2015-03-09
revisions: 7
authors: [r.osei]
status: current
alternates: [txt]
infobox:
  Parent: Distributed Inference Notes
  Topic: bus overhead of infer.act
---
**Appendix A: Bus overhead.** What it costs to move activations as base64 JSON over the [[Agent_Message_Bus|phero bus]].

## Per-message overhead

| Component | Bytes (typical) | Notes |
|---|---|---|
| IACP envelope | 140 | `v`, `id`, `from`, `to`, `kind`, `ts`, `ref` |
| bus frame | 4 | length prefix |
| base64 expansion | +33% | on the activation payload |
| JSON string escaping | +0–2% | rare |

For a Cinder-XL layer boundary (≈ 1.2 MB float16 per token batch), the payload becomes ≈ 1.6 MB and takes 6–11 ms to encode/decode on a forager host. At split=4 that happens three times per forward pass.

## Replay log pressure

Every `infer.act` lands in the trail's replay log ([[Agent_Message_Bus#Delivery_guarantees]]). With `trail_log_size = 10000` and 1.6 MB messages, the log for `forager.forager-09.infer` is 16 GB before the broker starts dropping. This is [[Known_Agent_Bugs#phero|AF-70]], the replay storm.

Mitigation used in 2015: a separate `infer.*` trail namespace with `trail_log_size = 50`. Documented in the 2015 raw measurement tables ([[Distributed_Inference_Notes/Appendix_B|Appendix B]] has the summary).

## What we should have done

Direct host-to-host activation transfer with the bus carrying only control messages. Estimated at two weeks in 2015. Never scheduled.

{{sig:r.osei|2015-03-09}}
