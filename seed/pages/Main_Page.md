---
id: Main_Page
title: Main Page
kind: article
categories: [ANTFARM]
created: 2009-11-02
modified: 2016-05-19
revisions: 41
authors: [wikiadmin, mkerrigan, svanterpool]
status: protected
infobox:
  Platform: ANTFARM 3.4
  Owner: HSC Orchestration group
  Wiki since: November 2009
---
Welcome to the **{{platform}} wiki**, the engineering documentation for the {{org}} orchestration platform. {{platform}} ({{platform}} = *Agent Network Task Fabric And Resource Manager*, a backronym nobody has ever said out loud) ran the cooperative's internal task agents from late 2009 until the 2016 retirement.

This wiki is **read-only**. It was archived in 2017 and restored as a mirror in 2021. If a page you need is missing, check the [old page index](/index/) or the [archive box](/archive/) before assuming it was never written.

## Core documentation

- [[Internal_Agent_Communication_Protocol|Internal Agent Communication Protocol]] (IACP) — how queens and foragers talk
- [[Agent_Message_Bus|Agent Message Bus]] — the phero bus, trails, and delivery guarantees
- [[Memory_Synchronization|Memory Synchronization]] — colony memory (cmsync) and its consistency model
- [[Tool_Registry|Tool Registry]] — toolreg, manifests, and how agents discover capabilities
- [[Worker_Node_Registry|Worker Node Registry]] — forager hosts, heartbeats, capacity
- [[Orchestrator_Recovery|Orchestrator Recovery]] — queen failover and the recovery runbook
- [[Distributed_Inference_Notes|Distributed Inference Notes]] — the 3.0 inference fabric
- [[Model_Compatibility_Matrix|Model Compatibility Matrix]] — which models ran on which runtime

## Reference

- [[Configuration_Reference|Configuration Reference]]
- [[Task_Graph_Format|Task Graph Format]] (`.tg` files)
- [[Legacy_Toolchain|Legacy Toolchain]] — `antc` and the pre-3.0 build
- [[API_Deprecation_Notes|API Deprecation Notes]] — what was removed, when, and why
- [[Known_Agent_Bugs|Known Agent Bugs]]
- [[Colony_Glossary|Colony Glossary]]
- [[Release_History|Release History]]
- [[Scheduler_Internals|Scheduler Internals]]

## Incidents and history

- [[Incident_2013-07_Queen_Split|Incident 2013-07: Queen split]]
- [[Incident_2015-02_Memory_Desync|Incident 2015-02: Memory desync]]
- [[Retirement_Plan_2016|Retirement plan (2016)]]

## New here?

Start with [[Getting_Started|Getting Started]], then the glossary. The [[Help:Editing|editing help]] page still exists but editing is disabled on the mirror.

<!-- wikiadmin 2014-02: the old "Operations" portal was merged into Orchestrator_Recovery; the drill pages were never moved. see [[Archive:Meeting_Notes_2012-Q3]] -->

## Recently changed

The [[Special:RecentChanges|recent changes]] list is frozen at the time of the archive. The last substantive human edit was svanterpool's note on the retirement page in May 2016.

{{clear}}
<div class="small">Mirror maintained as part of the Quantara Swarmglass archive programme. See [[ANTFARM_Wiki:About|About]].</div>
