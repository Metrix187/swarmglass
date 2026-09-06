---
id: Tool_Registry
title: Tool Registry
kind: article
categories: [ANTFARM Core, Tools]
created: 2011-04-20
modified: 2015-09-11
revisions: 33
authors: [mkerrigan, r.osei, dlopes]
status: current
alternates: [json, txt, yaml]
aliases: [Old_Tool_Registry, Toolreg]
experiment: SGX-007
infobox:
  Service: toolreg
  Port: 7423
  Schema: toolreg v2 (2015)
  Manifest format: JSON
  Owner: r.osei
---
The **Tool Registry** (`toolreg`) is the catalogue of capabilities a forager can invoke: file fetchers, converters, index writers, and the handful of model-backed tools added in 3.0. Agents do not embed tool definitions; they query the registry at startup and cache the manifest for the lifetime of the process.

## How discovery works

1. A forager starts and sends `tool.query` over the [[Agent_Message_Bus|phero bus]] with its runtime version.
2. `toolreg` answers `tool.reply` with a manifest filtered to tools compatible with that runtime.
3. The forager caches the manifest. Changes are pushed as `tool.update` (2.0+), but most foragers just restart nightly.

The manifest is also served over plain HTTP for humans and scripts at `http://toolreg.hm.internal:7423/manifest.json`. On this mirror a snapshot is available as {{attachment:toolreg-manifest-2015-09.json}}, and a machine-readable description of the mirror's own read API lives at [/api/v1/openapi.json](/api/v1/openapi.json).

## Manifest format (v2)

```json
{
  "schema": "toolreg/2",
  "generated": "2015-09-11T08:14:00Z",
  "tools": [
    {
      "name": "fetch.http",
      "version": "2.1.0",
      "runtime": ">=2.0",
      "description": "Fetch a URL from an allow-listed internal host.",
      "inputs": {"url": "string", "timeout_s": "int?"},
      "outputs": {"body": "bytes", "status": "int"},
      "cost": "io",
      "idempotent": true
    }
  ]
}
```

Fields added in v2: `cost` (`cpu` | `io` | `model`), `idempotent`, and `deprecated_by`. The v1 manifest had none of these, which is why the 2.x scheduler could not tell a cheap tool from a model call — see [[Scheduler_Internals#Cost_classes]].

## Registered tools (3.4 snapshot)

| Name | Version | Cost | Notes |
|---|---|---|---|
| `fetch.http` | 2.1.0 | io | allow-listed internal hosts only |
| `convert.doc2text` | 1.3.2 | cpu | uses the 2012 converter, known slow on large pdf |
| `index.write` | 3.0.1 | io | writes to colony memory, see [[Memory_Synchronization]] |
| `index.query` | 3.0.1 | io | |
| `model.summarize` | 0.4.0 | model | Basalt-2 only, see [[Model_Compatibility_Matrix]] |
| `model.classify` | 0.2.1 | model | Larkspur-S. deprecated 2015-08. |
| `graph.compile` | 1.0.0 | cpu | wraps `antc`, see [[Legacy_Toolchain]] |
| `notify.mail` | 1.1.0 | io | removed in 3.2 after the 2015 mail loop |

The full list as of the archive is in the manifest snapshot. The `Toolreg_Schema_v2` page that used to describe the schema in detail was not migrated to the new namespace, but the manifest carries an inline `$schema` reference.

## Security model

toolreg trusts the bus. There is no per-tool authorization; a forager that can reach the bus can call any tool the manifest lists. This was flagged in 2012 ([[Talk:Tool_Registry]]) and never addressed because the bus was only reachable from the colony subnet (`192.0.2.0/24`). Anyone reading this in a context where that assumption does not hold should stop and re-read it.

## See also

- [[Internal_Agent_Communication_Protocol#Message_kinds|IACP tool.query]]
- [[Deprecated_Agent_API]]
- [[Known_Agent_Bugs#toolreg]]
