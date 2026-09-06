---
id: Raw_Measurement_Tables_2015
title: Raw Measurement Tables 2015
kind: article
categories: [Models, ANTFARM 3.x]
created: 2015-01-20
modified: 2015-11-02
revisions: 14
authors: [r.osei]
status: current
alternates: [txt, json]
infobox:
  Parent: Appendix B
  Runs: 84
  Window: 2015-01 to 2015-11
---
Raw per-run numbers behind [[Distributed_Inference_Notes/Appendix_B]]. One row per run. Config hash is the sha1 of `model.conf` on the shard-0 host at run time.

| Run | Date | Model | split | runtime | tok/s | p50 | p95 | config | note |
|---|---|---|---|---|---|---|---|---|---|
| 001 | 2015-01-20 | Basalt-2 | 1 | 3.0.3 | 409 | 244 | 602 | 7c1e… | |
| 002 | 2015-01-20 | Basalt-2 | 1 | 3.0.3 | 415 | 238 | 611 | 7c1e… | |
| 003 | 2015-01-20 | Basalt-2 | 1 | 3.0.3 | 412 | 241 | 618 | 7c1e… | |
| 010 | 2015-01-27 | Basalt-2 | 2 | 3.0.3 | 188 | 540 | 1,880 | 7c1e… | |
| 011 | 2015-01-27 | Basalt-2 | 2 | 3.0.3 | 190 | 529 | 1,910 | 7c1e… | |
| 020 | 2015-02-03 | Cinder-XL | 2 | 3.0.3 | 70 | 1,420 | 4,100 | a91b… | ⚠ |
| 021 | 2015-02-03 | Cinder-XL | 2 | 3.0.3 | 73 | 1,398 | 4,260 | a91b… | ⚠ |
| 022 | 2015-02-24 | Cinder-XL | 2 | 3.0.3 | 71 | 1,410 | 4,200 | 7c1e… | rerun after desync |
| 030 | 2015-03-10 | Cinder-XL | 4 | 3.0.3 | 52 | 1,990 | 7,050 | 7c1e… | |
| 031 | 2015-03-10 | Cinder-XL | 4 | 3.0.3 | 51 | 1,975 | 7,140 | 7c1e… | |
| 040 | 2015-08-18 | Basalt-2 | 1 | 3.2.1 | 438 | 231 | 590 | 3d02… | |
| 041 | 2015-08-18 | Cinder-XL | 2 | 3.2.1 | 84 | 1,300 | 3,950 | 3d02… | |
| 042 | 2015-08-18 | Cinder-XL | 4 | 3.2.1 | 58 | 1,880 | 6,700 | 3d02… | |
| 080 | 2015-11-02 | Basalt-2 | 1 | 3.4.0-rc1 | 441 | 229 | 585 | e77f… | |
| 081 | 2015-11-02 | Cinder-XL | 2 | 3.4.0-rc1 | 88 | 1,270 | 3,900 | e77f… | |
| 082 | 2015-11-02 | Cinder-XL | 4 | 3.4.0-rc1 | 60 | 1,850 | 6,500 | e77f… | |

Runs 004–009, 012–019, 023–029, 032–039, 043–079 are in the JSON alternate of this page; they were omitted from the table to keep it readable.

The split=4 exploration — where the shards were placed, which trail sizes were tried, and why the numbers got *worse* — is written up separately on [[Cinder_XL_Split_Experiments]].

{{sig:r.osei|2015-11-02}}
