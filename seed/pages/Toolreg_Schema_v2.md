---
id: Toolreg_Schema_v2
title: Toolreg Schema v2
kind: article
categories: [Tools, Reference]
channels: [manifest]
created: 2015-08-03
modified: 2015-09-11
revisions: 7
authors: [r.osei, mkerrigan]
status: current
alternates: [json, yaml, txt]
infobox:
  Schema id: toolreg/2
  Format: JSON
  Referenced by: manifest $schema, well-known tools file
---
The v2 tool manifest schema, as served by `toolreg` from 3.2. This page moved during the 2015 namespace cleanup and was never re-linked from the [[Tool_Registry]] article; the manifest's `$schema` field and the mirror's machine-readable tools description still point here.

## Top level

| Field | Type | Notes |
|---|---|---|
| `schema` | `"toolreg/2"` | |
| `$schema` | url | this page's JSON alternate |
| `generated` | ISO 8601 | |
| `tools` | [Tool] | |

## Tool

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | dotted, lowercase |
| `version` | semver | yes | |
| `runtime` | range | yes | forager runtime range, e.g. `>=2.0` |
| `description` | string | yes | one line, for humans |
| `inputs` | map | yes | name → type. `?` suffix = optional |
| `outputs` | map | yes | |
| `cost` | `cpu` / `io` / `model` | yes | scheduler class |
| `idempotent` | bool | yes | may be retried on reissue |
| `deprecated_by` | string | no | replacement tool name |
| `hosts` | [string] | no | pin to hosts (shard tools) |

## Types

`string`, `int`, `float`, `bool`, `bytes`, `[T]`, `{T}` (map string→T). No unions, no nesting beyond one level; the 2011 discussion ([[Archive:Old_Tool_Manifest_Discussion]]) decided that anything more complex should be a separate tool.

## Validation

`antc check` validates manifests against this schema from 1.4. `toolreg` itself does not validate; a bad manifest is served as-is, and the first forager to parse it crashes. {{sig:r.osei|2015-09-11}}
