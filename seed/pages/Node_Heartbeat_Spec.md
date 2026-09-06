---
id: Node_Heartbeat_Spec
title: Node Heartbeat Spec
kind: article
categories: [Protocols, Reference]
channels: [header]
discover: header_only
created: 2013-11-04
modified: 2013-11-27
revisions: 6
authors: [mkerrigan]
status: current
alternates: [json, yaml, txt]
infobox:
  Message: hb (IACP)
  Interval: 10s
  Since: 2.3
---
Normative field list for the `hb` message body, defined after the [[Incident_2013-07_Queen_Split|2013 split]] made `epoch_seen` mandatory. The [[Worker_Node_Registry]] page links here through its HTTP `Link` header for tooling, which is a decision mkerrigan made in 2013 and would like to explain: the registry page was already too long.

## Body

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | forager name |
| `runtime` | string | yes | semver |
| `slots` | int | yes | total slots |
| `free` | int | yes | free slots |
| `load` | float | yes | 1-minute load / cores. displayed, ignored. |
| `capabilities` | [string] | yes | claimed capabilities |
| `epoch_seen` | int | **yes (2.3+)** | highest queen epoch this forager has accepted work from |
| `cache_age` | int | no | seconds since manifest fetch |
| `clock` | int | no | sender unix time, for skew measurement. never used for skew measurement. |

## Rules

1. A forager sends `hb` every 10 s regardless of activity.
2. A queen ignores `hb` from names not in its hosts file, and logs them once per hour.
3. Three missed → `evicted`. Eviction is *not* announced to the forager; it finds out when its next `task.result` is rejected with `reason: "evicted"`.
4. `epoch_seen` lower than current → queen sends `ctl.resync` before any assign.
5. `epoch_seen` *higher* than current → queen logs `SPLIT?` and refuses to assign. This is the split detector; it has fired twice, both times correctly.

## Example

```json
{"name":"forager-07","runtime":"3.4.1","slots":2,"free":1,"load":0.72,"capabilities":["fetch","convert","index","model.shard0"],"epoch_seen":131,"cache_age":8812,"clock":1459180801}
```

{{sig:mkerrigan|2013-11-27}}
