---
id: Talk:Memory_Synchronization
title: Talk:Memory Synchronization
kind: talk
categories: []
created: 2012-10-04
modified: 2015-08-21
revisions: 14
authors: [jbrandt, mkerrigan, svanterpool]
status: current
---
<div class="talk-thread">

## desync test harness

Putting it here because there is no better page. Runs on the test colony. Creates 500 keys on each queen with concurrent stamps, forces a partition with `iptables`, heals, and diffs.

```
#!/bin/sh
# desync-test.sh — jbrandt 2014-08
set -e
for i in $(seq 1 500); do
  cmsync put cm://test/desync/$i "q1-$i" --on queen01 &
  cmsync put cm://test/desync/$i "q2-$i" --on queen02 &
done
wait
ssh queen02 sudo iptables -A INPUT -s 192.0.2.10 -j DROP
sleep 90
ssh queen02 sudo iptables -D INPUT -s 192.0.2.10 -j DROP
sleep 10
cmsync diff queen01 queen02 | tee /tmp/desync-$(date +%s).txt | wc -l
```

Expected: 0 lines after 3.2 (leader wins). Before 3.2: ~250 lines, whichever queen's clock was ahead. {{sig:jbrandt|2014-08-22}}

<div class="talk-indent">Ran it after 3.2.0: 0 lines. Ran it after 3.2.1: 0 lines. Keeping it here. {{sig:svanterpool|2015-08-21}}</div>

</div>
<div class="talk-thread">

## GC

Are we ever doing garbage collection? 41 GB. {{sig:svanterpool|2016-01-11}}

<div class="talk-indent">3.6. {{sig:mkerrigan|2016-01-11}}</div>

<div class="talk-indent">There is no 3.6. {{sig:svanterpool|2016-05-19}}</div>

</div>
<div class="talk-thread">

## export format page

The snapshot format doc is on the feed but not linked here. Should be. {{sig:jbrandt|2014-09-02}}

<div class="talk-indent">The wiki upgrade ate the link. It's in the recent changes feed because archive-bot touched it. Someone add it back. {{sig:mkerrigan|2014-09-03}}</div>

</div>
