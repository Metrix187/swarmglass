---
id: Archive:Meeting_Notes_2012-Q3
title: Archive:Meeting Notes 2012-Q3
kind: archive
categories: [Archived, Meetings]
created: 2012-10-02
modified: 2012-10-02
revisions: 2
authors: [mkerrigan]
status: archived
---
{{archive}}

Orchestration group meeting, 2012-09-27. Present: mkerrigan, dlopes, tqian, svanterpool.

## 1. IACP 1.1 stays frozen

- 2.0 ships with 1.1 on the wire. IACP/2 stays on queen02.
- dlopes: batching is only needed for index writes. tqian: then make it a tool. Agreed — `index.write` gets a batch mode.
- **Decision:** 1.1 is the protocol until there is a reason. There has not been a reason.

## 2. Colony memory

- cmsync ready for 2.0. Tie-break rule discussed for four minutes; "lexically larger queen name" chosen because it was deterministic. (2015 note by svanterpool: it was deterministic.)

## 3. Toolchain

- tqian leaving in 2013. antc handover to r.osei "at some point". (Happened in 2014, for 1.4, with no overlap.)
- Old build scripts: keep the notes page, retire the scripts. [[Legacy_Toolchain/Pre-2012_Build_Notes]] stays.

## 4. Ops

- svanterpool wants a runbook. mkerrigan: the wiki is the runbook. svanterpool: the wiki is 40 pages of design. **Action:** svanterpool writes [[Orchestrator_Recovery]]. (Written 2011, actually; this action item was to make people read it.)
- Recovery drill: yearly, from 2013. Drill notes to go under the operations portal. The 2015 notes are the only ones that exist and they were never linked after the portal merge.

## 5. Wiki

- Old page index (`/index/`) to be kept until every page is re-linked. It was never re-linked and the index is still there.

{{sig:mkerrigan|2012-10-02}}
