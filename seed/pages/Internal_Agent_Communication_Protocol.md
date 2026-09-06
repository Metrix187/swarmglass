---
id: Internal_Agent_Communication_Protocol
title: Internal Agent Communication Protocol
kind: article
categories: [Protocols, ANTFARM Core]
created: 2010-03-14
modified: 2013-08-02
revisions: 27
authors: [mkerrigan, dlopes, tqian]
status: stale
alternates: [json, txt, yaml]
infobox:
  Abbreviation: IACP
  Current version: 1.1 (frozen 2011-04)
  Transport: phero bus (TCP 7421)
  Encoding: line-delimited JSON
  Owner: mkerrigan
---
The **Internal Agent Communication Protocol** (IACP) is the message-level contract between the orchestrator (the *queen*) and worker agents (*foragers*) in {{platform}}. It defines message envelopes, the request/response pairing rules, and the handful of control messages every agent must understand. IACP does not define transport; on every deployment we ever ran, that was the [[Agent_Message_Bus|phero bus]].

IACP 1.1 was frozen in April 2011 and remained the wire default through the 3.x line. IACP/2 exists on paper (see [[Deprecated_Agent_API]]) but was only ever enabled on the `queen02` test colony.

## Envelope

Every message is a single JSON object on one line, terminated by `\n`. Fields are lowercase. Unknown fields must be ignored, not rejected — this rule is the reason the 2012 API v2 rollout did not require a flag day.

```json
{"v":"1.1","id":"m-2f91c2","from":"forager-07","to":"queen","kind":"task.result","ts":1312284180,"body":{...}}
```

| Field | Required | Notes |
|---|---|---|
| `v` | yes | protocol version string. `"1.1"` in practice. |
| `id` | yes | opaque, unique per sender. foragers use `m-` + 6 hex; the queen uses `q-`. |
| `from` / `to` | yes | agent names from the [[Worker_Node_Registry]]. `queen` is reserved. |
| `kind` | yes | dotted type. see below. |
| `ts` | yes | unix seconds, sender clock. see [[Known_Agent_Bugs#Clock_skew]] |
| `ref` | no | id of the message being answered |
| `body` | no | kind-specific payload |

## Message kinds

; `task.assign` : queen → forager. carries a compiled task graph node (see [[Task_Graph_Format]]).
; `task.accept` / `task.reject` : forager → queen. reject must carry `body.reason`.
; `task.result` : forager → queen. partial results use `body.partial: true`.
; `task.cancel` : queen → forager. best effort.
; `hb` : both directions, every 10s. body is the heartbeat record from the [[Worker_Node_Registry|node registry]].
; `mem.sync` : see [[Memory_Synchronization]]. added in 2.0.
; `tool.query` / `tool.reply` : capability lookup against the [[Tool_Registry]].
; `ctl.drain` : queen → forager. finish current task, accept nothing new.
; `ctl.halt` : queen → forager. stop immediately. only sent during [[Orchestrator_Recovery|recovery]].

## Pairing rules

A forager may have at most one `task.assign` outstanding unless its registry record advertises `slots > 1`. Results must carry `ref` pointing at the assign message. The queen keeps unanswered assigns for `assign_timeout` (default 300s, [[Configuration_Reference#queen|config]]) and then reissues to a different forager — which is how the duplicate-execution bug in [[Known_Agent_Bugs]] happened.

## Versioning

- **1.0** (2010-03): initial. no `ref`, results were matched by task id. terrible.
- **1.1** (2011-04): `ref` added, `hb` body defined, unknown-field rule made explicit. **frozen.**
- **2.0** (2012-09, never default): binary framing, batched results, capability negotiation. see [[Deprecated_Agent_API]] and the [[Talk:Internal_Agent_Communication_Protocol|talk page]] for why it stalled.

## Example exchange

```
queen   → forager-07  {"v":"1.1","id":"q-00a1","from":"queen","to":"forager-07","kind":"task.assign","ts":1312284100,"body":{"node":"tg:crawl-index/3","deadline":1312284400}}
forager → queen       {"v":"1.1","id":"m-4f91c2","from":"forager-07","to":"queen","kind":"task.accept","ref":"q-00a1","ts":1312284101}
forager → queen       {"v":"1.1","id":"m-4f91c3","from":"forager-07","to":"queen","kind":"task.result","ref":"q-00a1","ts":1312284180,"body":{"status":"ok","artifacts":["cm://index/3"]}}
```

## See also

- [[Agent_Message_Bus]]
- [[Pheromone_Bus_Wire_Format]]
- [[Scheduler_Internals]]
- {{attachment:iacp-1.1-schema.json}} — the JSON schema tqian generated in 2011. Known to be slightly wrong about `ts`.
