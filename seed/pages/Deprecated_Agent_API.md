---
id: Deprecated_Agent_API
title: Deprecated Agent API
kind: article
categories: [API, Deprecated]
created: 2012-09-20
modified: 2014-10-15
revisions: 12
authors: [mkerrigan, dlopes]
status: deprecated
banner: deprecated
alternates: [json, txt, yaml]
experiment: SGX-008
infobox:
  Name: IACP/2
  Status: never shipped
  Superseded by: IACP 1.1 (kept), API v3 (HTTP)
  Last touched: 2014-10
---
**IACP/2** was the second-generation agent protocol designed alongside {{platform}} 2.0. It replaced JSON lines with a length-prefixed binary frame, allowed batching several task results in one message, and added capability negotiation so a forager could tell the queen which tools and message kinds it supported before receiving work.

It ran on the `queen02` test colony from late 2012 to early 2014 and was never enabled on the production colony. This page is retained because compiled bundles from that era still reference the `iacp/2` framing flag and people keep asking what it means.

{{#deprecated}}
> **Operator note (2016):** this document was superseded during the 3.4 cleanup. Anything still referencing IACP/2 should be treated as dead code.
{{/deprecated}}

## Frame layout

```
+--------+--------+----------------------+
| magic  | length | payload              |
| 2 bytes| 4 bytes| length bytes         |
+--------+--------+----------------------+
magic   = 0x41 0x46 ("AF")
length  = big-endian uint32, payload bytes
payload = msgpack map with the IACP 1.1 fields, plus:
          "batch": [ ...messages... ]   (optional)
          "caps":  { ... }             (only in hello)
```

## Capability negotiation

On connect, a forager sends a `hello` with `caps`:

```json
{"kind":"hello","caps":{"iacp":["1.1","2.0"],"tools":["fetch.http","index.write"],"batch":true,"max_frame":1048576}}
```

The queen answers with the intersection. In practice every forager advertised everything and the queen ignored `tools` because the [[Tool_Registry]] was the source of truth anyway.

## Why it stalled

From the [[Talk:Internal_Agent_Communication_Protocol|IACP talk page]], condensed:

1. The bus ([[Agent_Message_Bus]]) framed messages itself; binary framing inside bus frames saved nothing.
2. Batching helped one workload (index writes) and that workload got its own tool instead.
3. msgpack in 2012 had three incompatible Python implementations. Two foragers disagreed about how to encode `ts`.
4. The person driving it (dlopes) moved to the phero pair work in 2014.

## Migration guidance (historical)

If you find a bundle with `"framing": "iacp/2"`:

- Rebuild it with `antc build` from the `.tg` source ([[Legacy_Toolchain]]). The 1.4 compiler emits 1.1 framing regardless of the flag.
- If the source is gone, the bundle is unusable on any 3.x forager. There is no converter.

## See also

- [[API_Deprecation_Notes]]
- [[Internal_Agent_Communication_Protocol#Versioning]]
- {{attachment:iacp2-frame-notes.txt}}
