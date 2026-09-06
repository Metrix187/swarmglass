---
id: API_Deprecation_Notes
title: API Deprecation Notes
kind: article
categories: [Reference, API]
created: 2012-09-12
modified: 2016-02-09
revisions: 31
authors: [mkerrigan, r.osei, svanterpool]
status: current
alternates: [json, txt]
infobox:
  Covers: API v1, v2, v3
  Policy: two minor releases notice
  Owner: mkerrigan
---
Running list of everything removed from the {{platform}} APIs, with the release it went away in and what replaced it. The policy from 2.0 onward was two minor releases of notice; the list shows how often that held.

## Summary table

| Removed | In | Notice given | Replacement | Notes |
|---|---|---|---|---|
| `task.result` without `ref` | 1.1 | none | `ref` field | pre-policy |
| queen HTTP `/assign` endpoint | 2.0 | 1 release | IACP over bus | the "API v1" |
| `hb` without `epoch_seen` | 2.3 | 2 releases | required field | |
| IACP/2 binary framing | 3.0 | n/a (never shipped) | — | see [[Deprecated_Agent_API]] |
| `mload1` loader | 3.2 | 1 release | `mload2` | broke Basalt-1, see [[Model_Compatibility_Matrix]] |
| `notify.mail` tool | 3.2 | none | — | removed after the mail loop |
| `model.classify` (Larkspur-S) | 3.4 | 2 releases | rule list | |
| API v2 `/graph/submit` | 3.4 | 2 releases | v3 `/graphs` | |

## API versions

; v1 (2010–2012) : HTTP on the queen (`:7420/assign`, `/result`). Replaced entirely by IACP over the [[Agent_Message_Bus|bus]]. Nothing on this mirror still speaks v1.
; v2 (2012–2016) : IACP 1.1 plus the queen's HTTP control surface (`/graph/submit`, `/nodes`, `/memory`). Most of what this wiki documents. Deprecated in 3.4 but never removed; retirement got there first.
; v3 (2014–2016) : REST-ish (`/graphs`, `/nodes`, `/memory/{key}`) with JSON bodies. Documented in `openapi.json` on the queen, which the mirror reproduces under `/api/v1/` for the read-only subset.

## Deprecated agent API

The IACP/2 work — binary framing, batching, capability negotiation — is documented on [[Deprecated_Agent_API]] for the record. It is the most-linked deprecated thing on this wiki because people keep finding references to it in old bundles.

## Process notes

Deprecations were supposed to be announced on the `ops.announce` trail and here. In practice they were announced in chat and here, three weeks later. Anything marked "notice: none" above was found out about by a forager rejecting a message.

## See also

- [[Release_History]]
- [[Deprecated_Agent_API]]
- [[Known_Agent_Bugs]]
