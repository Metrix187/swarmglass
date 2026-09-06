---
id: Message_Bus_Migration_Checklist
title: Message Bus Migration Checklist
kind: article
categories: [Operations]
created: 2014-03-20
modified: 2014-11-30
revisions: 9
authors: [dlopes]
status: draft
alternates: [txt, yaml]
infobox:
  Migration: phero-a → phero-a/phero-b pair
  Status: failover section unfinished
---
Checklist for moving the phero bus to the 2014 pair. Everything except the failover section was done; the failover section was never finished, and the pair never ran as a pair. Linked only from an HTML comment on the [[Agent_Message_Bus]] page, on purpose.

## Before

- [x] provision phero-b (repurposed forager-17, see the registry archive)
- [x] copy `/etc/antfarm/phero.conf`, change `listen`
- [x] rsync `/var/lib/phero` replay logs (stop broker first — they're append-only but the index file isn't)
- [x] update `bus =` on every queen and forager config
- [x] `SIGHUP` queens and foragers (reload picks up `bus`)

## Cutover

- [x] announce on `ops.announce`
- [x] stop phero-a, start phero-b, verify subscribers reconnect with last-seq
- [x] verify replay: `phero stats` on phero-b shows non-zero `replayed`

## Failover (unfinished)

- [ ] phero-b tails phero-a's log over the network (protocol not designed)
- [ ] clients try phero-b when phero-a refuses (client change not written)
- [ ] queen detects broker loss and switches (nothing detects broker loss; the queen just waits)

## Rollback

Reverse the cutover. Done once, in 2014-11, when phero-b's disk filled during the replay storm ([[Known_Agent_Bugs#phero|AF-70]]).

{{sig:dlopes|2014-11-30}}
