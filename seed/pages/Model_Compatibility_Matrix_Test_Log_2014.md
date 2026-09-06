---
id: Model_Compatibility_Matrix/Test_Log_2014
title: Model Compatibility Matrix/Test Log 2014
kind: article
categories: [Models, Reference]
created: 2014-01-09
modified: 2014-12-30
revisions: 22
authors: [r.osei, jbrandt]
status: archived
alternates: [txt, json]
infobox:
  Parent: Model Compatibility Matrix
  Entries: 31
  Year: 2014
---
Log of `antc test` runs backing the 2014 column of the [[Model_Compatibility_Matrix]]. One line per run; `commit` is the runtime repo hash.

| Date | Model | Runtime | Result | Commit | By | Note |
|---|---|---|---|---|---|---|
| 2014-01-09 | Basalt-1 | 2.3.2 | pass | 41ac9e | r.osei | |
| 2014-01-09 | Larkspur-S | 2.3.2 | pass | 41ac9e | r.osei | |
| 2014-03-14 | Basalt-2 (pre) | 2.3.4 | pass | 9b02f1 | r.osei | first Basalt-2 run |
| 2014-06-02 | Basalt-2 | 3.0.0-dev | pass | c3d7a0 | jbrandt | |
| 2014-06-02 | Basalt-1 | 3.0.0-dev | pass | c3d7a0 | jbrandt | legacy loader |
| 2014-06-03 | Larkspur-S | 3.0.0-dev | pass | c3d7a0 | jbrandt | |
| 2014-07-15 | Basalt-2 | 3.0.0-dev | pass | e1e1e1 | jbrandt | split=2, forager-07/09 |
| 2014-07-15 | Basalt-2 | 3.0.0-dev | fail | e1e1e1 | jbrandt | split=4, shard 3 OOM |
| 2014-09-30 | Basalt-2 | 3.0.0-rc2 | pass | 0f0f0f | r.osei | |
| 2014-09-30 | Basalt-1 | 3.0.0-rc2 | pass | 0f0f0f | r.osei | (table says ✔; this is the only log entry) |
| 2014-10-20 | Basalt-2 | 3.0.0 | pass | 77aa10 | r.osei | release |
| 2014-11-11 | Larkspur-S | 3.0.1 | pass | 77aa12 | r.osei | |
| 2014-12-30 | Basalt-2 | 3.0.2 | pass | 8e8e8e | r.osei | |

Missing: the eighteen runs between June and September that jbrandt kept in a spreadsheet. The spreadsheet is in the attachments as an export: {{attachment:test-log-2014-export.csv}}.

{{sig:r.osei|2014-12-30}}
