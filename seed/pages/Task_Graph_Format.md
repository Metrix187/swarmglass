---
id: Task_Graph_Format
title: Task Graph Format
kind: article
categories: [Reference, Tools]
created: 2010-02-18
modified: 2014-10-20
revisions: 21
authors: [tqian, mkerrigan]
status: current
alternates: [txt]
infobox:
  Extension: .tg
  Compiler: antc
  Grammar version: 3 (2012)
---
A **task graph** is a text file describing a DAG of tool calls. `antc` ([[Legacy_Toolchain]]) compiles it into a bundle the queen can assign node by node.

## Syntax

```
graph <name> {
  <node> = <tool>(<arg>: <expr>, ...)
  ...
}
```

- `<tool>` must exist in the [[Tool_Registry|manifest]] at compile time.
- `<expr>` is a literal (`"string"`, `42`, `true`) or a reference `<node>.<output>`.
- References define edges. A node runs when every referenced node has a result.
- Nodes without references are roots and are assigned immediately.

## Example

```
graph crawl-index {
  seed   = fetch.http(url: "http://wiki.hm.internal/wiki/Special:AllPages")
  pages  = convert.doc2text(input: seed.body)
  idx    = index.write(key: "cm://index/latest", value: pages.text)
  sum    = model.summarize(input: pages.text, max_tokens: 200)
  note   = index.write(key: "cm://index/latest/summary", value: sum.text)
}
```

`sum` and `idx` both depend only on `pages` and run in parallel on two foragers. `note` waits for `sum`.

## Attributes

Attributes go in square brackets after the node name:

```
  sum [deadline: 600, retries: 2, cost: model] = model.summarize(...)
```

| Attribute | Meaning |
|---|---|
| `deadline` | seconds after assignment; past it the queen reissues (see AF-80 for what happens when it is already past) |
| `retries` | reject/failure retries before the graph fails |
| `cost` | override the manifest cost class |
| `pin` | forager name; forces assignment |

## Cycles

Cycles are invalid. `antc check` catches them except through `model.*` nodes in 1.4 ([[Known_Agent_Bugs#Scheduler|AF-83]]). If a graph hangs with no progress, this is the first thing to check.

## Grammar history

- v1 (2010): no attributes, `->` edge syntax. Rejected by 1.2+.
- v2 (2011): reference syntax, attributes.
- v3 (2012): string escapes, `pin`. Current.

## See also

- [[Legacy_Toolchain]]
- [[Scheduler_Internals]]
- [[Getting_Started#Your_first_task_graph]]
