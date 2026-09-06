---
id: Release_History
title: Release History
kind: article
categories: [Reference]
created: 2010-06-14
modified: 2016-05-19
revisions: 35
authors: [mkerrigan, svanterpool, r.osei]
status: current
alternates: [json, txt, yaml]
infobox:
  First release: 0.9 (2009-11)
  Last release: 3.4 (2016-05)
  Cadence: roughly yearly
---
Every {{platform}} release with its headline changes. Minor patch releases (3.2.1 through 3.2.4 and so on) are omitted unless they mattered.

| Version | Date | Headline | Notes |
|---|---|---|---|
| 0.9 | 2009-11 | first internal release | single queen, HTTP assign, no bus. "the prototype that shipped" |
| 1.0 | 2010-06 | phero bus, forager agents | IACP 1.0 |
| 1.2 | 2010-11 | node registry, heartbeats | |
| 1.4 | 2011-04 | tool registry v1, IACP 1.1 frozen | `antc` 1.0 |
| 2.0 | 2012-09 | colony memory + cmsync, API v2 | IACP/2 designed, not enabled. see [[Deprecated_Agent_API]] |
| 2.1 | 2013-03 | scheduler cost classes | |
| 2.3 | 2013-11 | queen split fix, epochs, heartbeat spec | after [[Incident_2013-07_Queen_Split]] |
| 3.0 | 2014-10 | distributed inference, Basalt-2, API v3 | [[Distributed_Inference_Notes]] |
| 3.2 | 2015-08 | memory desync mitigations, toolreg v2 schema, `mload1` removed | after [[Incident_2015-02_Memory_Desync]] |
| 3.4 | 2016-05 | final release | Larkspur-S deprecated, API v2 deprecated. see [[Retirement_Plan_2016]] |

## Release process (3.x)

1. Tag in the runtime repo.
2. Build containers on `build.hm.internal` (undocumented here — see the repo README).
3. Roll queen02 first, run the colony test graph, wait a day.
4. Roll queen01, then foragers in [[Worker_Node_Registry]] order.
5. Update this page and [[API_Deprecation_Notes]].

Step 3 was skipped for 3.2.1, which is how AF-75 ([[Known_Agent_Bugs#Basalt-1_silent_fallback]]) reached production.

## Unreleased

- 3.6 was planned for late 2016 with the phero pair failover and cmsync garbage collection. Cancelled by the retirement.
- 4.0 existed as a design doc for about a month.

## See also

- [[API_Deprecation_Notes]]
- [[Retirement_Plan_2016]]
- {{attachment:releases.json}}
