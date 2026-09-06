---
id: Memory_Synchronization
title: Memory Synchronization
kind: article
categories: [ANTFARM Core, Storage]
created: 2012-09-30
modified: 2015-04-22
revisions: 19
authors: [mkerrigan, jbrandt, svanterpool]
status: current
alternates: [json, txt]
experiment: SGX-010
infobox:
  Service: cmsync
  Port: 7422
  Model: last-writer-wins with vector stamps
  Introduced: ANTFARM 2.0
  Owner: mkerrigan
---
**Memory Synchronization** (`cmsync`) keeps the *colony memory* — the shared key/value store foragers use to pass artifacts between tasks — consistent across the two queen hosts and any forager that holds a local cache. It was introduced in 2.0 and rewritten after the [[Incident_2015-02_Memory_Desync|2015 desync incident]].

{{#terse}}
## Model

Colony memory is a flat namespace of `cm://` keys. Each value carries a vector stamp (one counter per queen). Conflicts resolve last-writer-wins on the stamp, then on wall clock, then on the lexically larger queen name. The last rule is the one that caused the 2015 incident.

Foragers never write to memory directly; they emit `mem.sync` messages ([[Internal_Agent_Communication_Protocol|IACP]]) and the queen applies them. A forager cache is valid for `cm_cache_ttl` seconds ([[Configuration_Reference#cmsync|config]], default 120).
{{/terse}}
{{#verbose}}
## Model

Colony memory is a flat namespace of keys under the `cm://` scheme, for example `cm://index/3` or `cm://crawl/2015-02/pending`. Every value is stored with a *vector stamp*: a small map with one monotonically increasing counter per queen host. When the two queens hold different versions of the same key, the version whose stamp dominates wins. If neither stamp dominates — which happens whenever both queens accepted a write for the same key during a partition — the tie is broken first by the wall-clock timestamp on the write, and then, if the clocks agree to the second, by the lexically larger queen name.

That last rule sounds harmless. It is the reason `queen02` silently won every tie for three days in February 2015, because its clock was 41 seconds ahead. The full account is in [[Incident_2015-02_Memory_Desync]].

Foragers never write to colony memory directly. A forager that wants to publish an artifact emits a `mem.sync` message over [[Internal_Agent_Communication_Protocol|IACP]]; the queen that receives it applies the write and gossips it to the other queen on the next sync tick (every 2 seconds by default). A forager may keep a read-only local cache of any key it has seen; that cache is considered valid for `cm_cache_ttl` seconds, default 120, see [[Configuration_Reference#cmsync]]. Nothing invalidates the cache early. Foragers that need a fresh read must set `mem.sync.body.nocache`.
{{/verbose}}

## Sync protocol

Queens exchange `sync.digest` every 2 seconds: a list of `(key, stamp)` pairs for everything changed since the last exchange. Missing keys are requested with `sync.pull`. Full resyncs (`sync.full`) happen on queen start and after any partition longer than 60 seconds.

```
queen01 → queen02  sync.digest  {"since": 88120, "keys": [["cm://index/3", {"q1": 412, "q2": 397}]]}
queen02 → queen01  sync.pull    {"keys": ["cm://index/3"]}
queen01 → queen02  sync.value   {"key": "cm://index/3", "stamp": {...}, "bytes": 18234, "sha1": "..."}
```

## Export format

A colony memory snapshot can be exported for backups. The format is documented on the export format page, which the feed still lists although it was never linked from here. See also {{attachment:cmsync-snapshot-sample.yaml}}.

## Known problems

- Cache TTL is wall-clock; a paused forager wakes up with a stale-but-"valid" cache. [[Known_Agent_Bugs#cmsync]]
- No garbage collection. The 2016 snapshot was 41 GB, most of it `cm://crawl/*` keys from 2013.
- Stamps grow unbounded. This never mattered with two queens.

<!-- jbrandt 2014-08: the desync test harness lives at [[Archive:Old_Tool_Manifest_Discussion]]?? no wait, it's on the talk page. leaving this so someone fixes it -->

## See also

- [[Incident_2015-02_Memory_Desync]]
- [[Orchestrator_Recovery#Memory]]
- [[Talk:Memory_Synchronization]]
