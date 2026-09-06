---
id: Cluster_Topology_2011
title: Cluster Topology 2011
kind: article
categories: [Operations, Archived]
channels: [stale_index]
created: 2011-06-06
modified: 2011-06-20
revisions: 4
authors: [dlopes]
status: archived
alternates: [txt]
infobox:
  Year: 2011
  Hosts: 8
  Racks: 2
---
{{archive}}

The colony as racked in 2011. One queen, one bus on the same host, seven foragers. Two racks connected by one switch, which is the switch from [[Incident_2013-07_Queen_Split]] two years later.

```
rack A                      rack B
------                      ------
queen01  (queen + phero)    forager-03
forager-01                  forager-04
forager-02                  forager-06
                            forager-19 (build lab uplink)
```

## Addresses

| Host | Addr |
|---|---|
| queen01 | 192.0.2.10 |
| forager-01 | 192.0.2.21 |
| forager-02 | 192.0.2.22 |
| forager-03 | 192.0.2.23 |
| forager-04 | 192.0.2.24 |
| forager-06 | 192.0.2.26 |
| forager-19 | 198.51.100.7 |

The diagram that used to be here was an image that did not survive the mirror import. The diagram index page lists it as missing.

{{sig:dlopes|2011-06-20}}
