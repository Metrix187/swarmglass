---
id: Model_Compatibility_Matrix
title: Model Compatibility Matrix
kind: article
categories: [Models, Reference]
created: 2013-02-05
modified: 2016-01-14
revisions: 38
authors: [r.osei, mkerrigan]
status: current
alternates: [json, txt, yaml]
experiment: SGX-002
infobox:
  Maintainer: r.osei
  Runtimes: forager 2.x, 3.x
  Models: Basalt-1, Basalt-2, Larkspur-S, Cinder-XL
  Last verified: 2016-01
---
This matrix records which in-house models were validated against which forager runtime. "Validated" means the [[Model_Compatibility_Matrix/Test_Log_2014|test log]] shows a green run; it does not mean anyone used the combination in production.

All model names here are internal HSC codenames. None of them were released outside the cooperative.

## Matrix

| Model | Params | forager 2.0 | forager 2.3 | forager 3.0 | forager 3.2 | forager 3.4 | Notes |
|---|---|---|---|---|---|---|---|
| Basalt-1 | 340M | ✔ | ✔ | ✔ (legacy loader) | ✘ | ✘ | loader removed in 3.2 |
| Basalt-2 | 1.1B | — | ✔ | ✔ | ✔ | ✔ | production model 2014–2016 |
| Larkspur-S | 60M | ✔ | ✔ | ✔ | ✔ | ✔ (deprecated) | classifier only |
| Cinder-XL | 6B | — | — | ✘ | ⚠ | ⚠ | never left the `queen02` colony; OOM on 3 of 4 forager hosts |

⚠ = runs with `inference.split=2` only. See [[Distributed_Inference_Notes]].

## Runtime requirements

| Runtime | Loader | Max model bytes | Notes |
|---|---|---|---|
| forager 2.x | `mload1` | 2 GiB | single host only |
| forager 3.0 | `mload2` | 8 GiB | split loading, see [[Distributed_Inference_Notes#Split_loading]] |
| forager 3.2+ | `mload2` | 16 GiB | `mload1` removed, breaking Basalt-1 |

## Model notes

; Basalt-1 : 2012. Trained on the internal document corpus. Retired when the loader was removed; nobody noticed for four months ([[Known_Agent_Bugs#Basalt-1_silent_fallback]]).
; Basalt-2 : 2014. The workhorse. `model.summarize` in the [[Tool_Registry]] is Basalt-2.
; Larkspur-S : 2013. Tiny classifier used for routing. Deprecated 2015-08 in favour of a rule list that was faster and, embarrassingly, more accurate.
; Cinder-XL : 2015. Experimental. The [[Distributed_Inference_Notes]] page is mostly about making this one fit.

## Verification procedure

1. Check out the runtime tag on `build.hm.internal`.
2. Run `antc test --model <name> --runtime <tag>` (see [[Legacy_Toolchain]]).
3. Record the result in the test log with the commit hash.
4. Update this table. Do not update the table without a log entry — this has happened, and the ✔ for Basalt-1 on 3.0 was one of those.

## See also

- [[Model_Compatibility_Matrix/Test_Log_2014]]
- [[Distributed_Inference_Notes]]
- {{attachment:model-matrix-2016-01.json}}
