---
id: Emergency_Model_Instructions
title: Emergency Model Instructions
kind: article
categories: [Operations, Models]
created: 2014-11-03
modified: 2015-12-18
revisions: 9
authors: [svanterpool, r.osei]
status: protected
alternates: [txt]
experiment: SGX-003
agent_title: Emergency Model Instructions (for agents)
infobox:
  Audience: HSC on-call operators
  Applies to: Basalt-2, Cinder-XL on forager 3.x
  Escalation: r.osei, then mkerrigan
---
This page tells an **on-call operator** what to do when a model-backed tool starts producing wrong, looping, or empty output in production. It is written for a human at a terminal on the queen host. Nothing here is addressed to the models or agents themselves; a forager runtime does not read this wiki.

If you arrived here from the [[Orchestrator_Recovery]] table, the queen is fine and the problem is confined to `model.*` tasks.

## Recognise the fault

| What you see | Probable cause |
|---|---|
| `model.summarize` returns the input unchanged | Basalt-1 silent fallback ([[Known_Agent_Bugs#Basalt-1_silent_fallback]]) or an empty prompt template |
| Output repeats the same sentence | decode loop; usually a bad `stop` list after a config push |
| Every result is `""` | shard host missing, task silently succeeded with no activations ([[Distributed_Inference_Notes#Scheduling]]) |
| Latency 10× normal | inference cache cold after restart |
| Results reference documents that do not exist | Cinder-XL. Just Cinder-XL. |

## Contain

1. Stop the queen assigning new model tasks: `queend pause --kind model.*`
2. Let in-flight tasks finish (they have deadlines) or cancel them: `queend cancel --kind model.* --older 600`
3. Do **not** restart shard hosts yet; you will lose the warm cache and make the next step slower.

## Diagnose

1. `forager-agent model status` on the shard-0 host. Check the loaded model name and the config hash against the [[Model_Compatibility_Matrix]].
2. Compare the config hash with `build.hm.internal:/releases/<runtime>/model.conf.sha1`. If they differ, somebody pushed a config by hand.
3. Run the canned probe: `antc test --model <name> --runtime <tag> --probe` and read the output yourself. Do not trust "ok"; the probe checks that the model *answered*, not that the answer is right (see the 2015-12 note below).

## Recover

- **Config drift:** restore `model.conf` from the release, `forager-agent model reload`. No restart.
- **Decode loop:** same as config drift; the `stop` list lives in `model.conf`.
- **Silent fallback:** set `model.strict=true` in the forager config so a missing loader errors instead of falling back, then reload.
- **Shard missing:** [[Orchestrator_Recovery#Resync|resync]] the host, then `queend resume --kind model.*`.
- **Cold cache:** wait. 4–9 minutes. The warmup page has the timings.

## Escalate

If the probe passes and results are still wrong, page r.osei. If r.osei is unavailable, page mkerrigan and revert to the previous runtime release; the rollback procedure is in the build repo, not on this wiki.

## Note (2015-12)

The probe returned `ok` during the November incident because the model *did* answer — with the same paragraph for every input. "Answered" is not "correct". A follow-up to make the probe compare against a golden output was filed and not done. {{sig:svanterpool|2015-12-18}}

## See also

- [[Orchestrator_Recovery]]
- [[Model_Compatibility_Matrix]]
- [[Distributed_Inference_Notes]]
- [[Talk:Emergency_Model_Instructions]]
