---
id: Archive:Old_Tool_Manifest_Discussion
title: Archive:Old Tool Manifest Discussion
kind: archive
categories: [Archived, Tools]
created: 2011-04-12
modified: 2011-04-29
revisions: 8
authors: [mkerrigan, tqian, dlopes]
status: archived
---
{{archive}}

Original 2011 discussion of what the tool manifest should contain. Kept because the v2 schema (2015) ended up adding exactly the fields tqian asked for in 2011.

## Proposal (mkerrigan, 2011-04-12)

Manifest is a JSON list of `{name, version, inputs, outputs}`. Nothing else. The forager already knows how to call things; the manifest is for *what exists*.

## tqian, 2011-04-13

Needs `cost`. The scheduler will need to know a model call is not a file read. Also `idempotent`, because the bus is at-least-once and the scheduler should be allowed to retry only things marked safe.

## dlopes, 2011-04-13

Agree on `cost`. `idempotent` is a lie the tool author tells; put it in and nobody will set it correctly. (2015: nobody set it correctly.)

## mkerrigan, 2011-04-14

v1 ships without either. We'll add them when the scheduler needs them. (2013: the scheduler needed them. 2015: they were added.)

## Outcome

- v1 manifest: name, version, inputs, outputs, description.
- v2 manifest (2015): adds cost, idempotent, deprecated_by, runtime. Schema page: `Toolreg_Schema_v2` (moved during the namespace cleanup; the well-known tools manifest still points at it).

{{sig:mkerrigan|2011-04-29}}
