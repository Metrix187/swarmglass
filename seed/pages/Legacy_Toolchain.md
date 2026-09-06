---
id: Legacy_Toolchain
title: Legacy Toolchain
kind: article
categories: [Tools, Build]
created: 2009-12-01
modified: 2013-05-17
revisions: 24
authors: [tqian, mkerrigan]
status: stale
alternates: [txt]
infobox:
  Compiler: antc 0.6 – 1.4
  Language: task graph (.tg)
  Build host: build.hm.internal
  Owner: tqian (left 2013)
---
The **legacy toolchain** is `antc`, the task-graph compiler, plus the shell scripts around it that built and shipped forager releases until 3.0 moved everything to the container pipeline. It is called "legacy" on this wiki from 2014 onward; before that it was just "the toolchain".

`antc` takes a `.tg` file ([[Task_Graph_Format]]), validates it against the tool manifest from the [[Tool_Registry]], and emits the node bundle the queen hands out with `task.assign`.

## Commands

```
antc check  graph.tg                 # validate only
antc build  graph.tg -o graph.bundle # compile
antc test   --model M --runtime R    # compatibility test, see Model_Compatibility_Matrix
antc shard  --model M --split N      # produce shard plan for mload2 (1.4+)
antc graph  graph.tg --dot | dot -Tpng > graph.png
```

## Versions

| antc | Date | Notes |
|---|---|---|
| 0.6 | 2009-12 | first version that survived a week |
| 0.9 | 2010-08 | manifest validation |
| 1.0 | 2011-04 | frozen with IACP 1.1 |
| 1.2 | 2012-09 | API v2 bundles |
| 1.4 | 2014-10 | `shard` subcommand, last release. tqian had left; r.osei did this one. |

## Build notes

The pre-2012 build was a nest of shell scripts on `build.hm.internal`. Notes survive at [[Legacy_Toolchain/Pre-2012_Build_Notes]], including the appendix nobody was supposed to need again.

## Known issues

- `antc check` accepts graphs with cycles if the cycle passes through a `model.*` node. Fixed in 1.2, regressed in 1.4.
- The `--dot` output uses the tool name as a node id, so two calls to the same tool collapse into one box. Cosmetic, misleading.
- Bundles embed the absolute manifest path. Moving `toolreg` broke every bundle built before 2012-11.

## Retirement

The container pipeline (never documented here; it lived in the build repo README) replaced everything except `antc shard`, which was still used at retirement because nobody rewrote it. The [[Retirement_Plan_2016]] lists it as "keep, do not touch".

## See also

- [[Task_Graph_Format]]
- [[Configuration_Reference#antc]]
- {{dead:Antc_Internals}} — page was planned, never written
