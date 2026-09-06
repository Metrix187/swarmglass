---
id: Worker_Node_Registry_Archive
title: Worker Node Registry Archive
kind: article
categories: [Operations, Archived]
channels: [sitemap]
created: 2013-01-15
modified: 2015-12-01
revisions: 9
authors: [svanterpool]
status: archived
alternates: [yaml, txt]
infobox:
  Content: decommissioned forager records
  Hosts: 8
  Source: nightly registry export
---
Registry records for foragers decommissioned between 2012 and 2015. Kept for capacity history. Not linked from the [[Worker_Node_Registry|live registry page]] because the sitemap generator picks it up anyway — which is the only reason anyone ever finds it.

| Name | Addr | Runtime at decommission | Decommissioned | Reason |
|---|---|---|---|---|
| forager-04 | 192.0.2.24 | 1.4.2 | 2012-05 | disk |
| forager-06 | 192.0.2.26 | 2.0.1 | 2012-11 | moved to build lab |
| forager-08 | 192.0.2.28 | 2.1.0 | 2013-08 | rack B decommission after the [[Incident_2013-07_Queen_Split|split]] |
| forager-10 | 192.0.2.30 | 2.3.1 | 2014-02 | disk |
| forager-11 | 192.0.2.31 | 2.3.1 | 2014-02 | disk (same batch) |
| forager-13 | 192.0.2.33 | 3.0.0 | 2014-12 | memory too small for mload2 |
| forager-17 | 192.0.2.37 | 3.0.2 | 2015-03 | repurposed as phero-b |
| forager-18 | 192.0.2.38 | 3.2.0 | 2015-12 | repurposed as build host |

Full records with last heartbeat and capabilities: {{attachment:node-registry-archive.yaml}}.

{{sig:svanterpool|2015-12-01}}
