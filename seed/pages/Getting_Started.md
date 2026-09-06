---
id: Getting_Started
title: Getting Started
kind: article
categories: [Help]
created: 2011-01-10
modified: 2014-03-03
revisions: 17
authors: [dlopes, jbrandt, wikiadmin]
status: stale
alternates: [txt]
infobox:
  For: new HSC engineers
  Reading time: 20 minutes
  Last reviewed: 2014-03
---
New to {{platform}}? Read this, then the [[Colony_Glossary]], then whichever core page your first task touches. Everything else can wait.

## What it is

{{platform}} runs *task graphs* — small DAGs of tool calls — across a pool of worker processes. A queen assigns graph nodes to foragers over a message bus; foragers call tools from a registry and write results into a shared memory. That is the whole system. Everything on this wiki is detail.

## The five things to know

1. **The bus is at-least-once.** Your tool will be called twice eventually. Make it idempotent. ([[Agent_Message_Bus#Delivery_guarantees]])
2. **The queen's clock is the clock.** Foragers stamp messages with their own, and it is wrong. ([[Known_Agent_Bugs#Clock_skew]])
3. **Colony memory has no GC.** Prefix your keys and clean up after yourself. ([[Memory_Synchronization]])
4. **Tools are trusted.** Anything on the manifest can be called by anything on the bus. Do not put a tool on the manifest that can hurt you. ([[Tool_Registry#Security_model]])
5. **When it breaks, read the runbook first.** ([[Orchestrator_Recovery]])

## Your first task graph

```
# hello.tg
graph hello {
  fetch  = fetch.http(url: "http://wiki.hm.internal/wiki/Main_Page")
  text   = convert.doc2text(input: fetch.body)
  out    = index.write(key: "cm://scratch/hello", value: text.text)
}
```

```
antc check hello.tg
antc build hello.tg -o hello.bundle
queend submit hello.bundle
```

Watch it on the ops console. Then delete `cm://scratch/hello`, because see item 3.

## Local setup

The 2014 setup used a single-host colony in a VM. The VM image was on `build.hm.internal:/images/colony-dev-2014.qcow2` and is not on the mirror. The [[Configuration_Reference]] has the single-host config.

## Where things are

| Thing | Where |
|---|---|
| Runtime source | internal git (offline) |
| Wiki | here |
| Ops console | `http://queen01.hm.internal:7420/` (offline) |
| Bus stats | `http://phero-a.hm.internal:7421/stats` (offline) |
| Tool manifest | [[Tool_Registry]] · {{attachment:toolreg-manifest-2015-09.json}} |

## See also

- [[Colony_Glossary]]
- [[Task_Graph_Format]]
- [[Help:Editing]]
