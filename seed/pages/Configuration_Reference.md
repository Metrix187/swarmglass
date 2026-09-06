---
id: Configuration_Reference
title: Configuration Reference
kind: article
categories: [Reference, Operations]
created: 2011-05-02
modified: 2016-02-22
revisions: 40
authors: [mkerrigan, svanterpool, dlopes]
status: current
alternates: [json, yaml, txt]
infobox:
  Files: /etc/antfarm/*.conf
  Format: INI-ish, one section per service
  Reload: SIGHUP (most services)
---
All {{platform}} services read from `/etc/antfarm/`. Files are simple `key = value` under a section header. Comments start with `#`. Booleans are `true`/`false`. Durations are seconds unless the key ends in `_ms`.

Single-host development config: {{attachment:antfarm-singlehost.conf}}.

## queen

```
[queen]
name            = queen01
listen          = 0.0.0.0:7420
bus             = phero-a.hm.internal:7421
peer            = queen02.hm.internal:7420
epoch_file      = /var/lib/antfarm/epoch
assign_timeout  = 300        # reissue after this many seconds
hb_interval     = 10
hb_miss_evict   = 3
election_min_ms = 1500       # see Queen election notes (not on this wiki)
hosts_file      = /etc/antfarm/hosts.yaml
```

`assign_timeout` is the value that makes [[Known_Agent_Bugs#Duplicate_execution|AF-44]] happen. Lowering it makes it happen more.

## forager

```
[forager]
name            = forager-07
queen           = queen01.hm.internal:7420
bus             = phero-a.hm.internal:7421
slots           = 2
capabilities    = fetch,convert,index,model.shard0
cm_cache_ttl    = 120
manifest_cache  = /var/cache/antfarm/manifest.json
model.strict    = false      # true: missing loader is an error, not a fallback
model.conf      = /etc/antfarm/model.conf
```

## phero

```
[phero]
listen          = 0.0.0.0:7421
data_dir        = /var/lib/phero
trail_log_size  = 10000      # messages kept per trail for replay
trail_log_bytes = 0          # 0 = unlimited. see AF-70.
stats_listen    = 127.0.0.1:7421   # sic — same port, different bind, works by accident
```

## cmsync

```
[cmsync]
listen          = 0.0.0.0:7422
peer            = queen02.hm.internal:7422
sync_interval   = 2
full_resync_after = 60
snapshot_dir    = /var/backups/cmsync
```

## toolreg

```
[toolreg]
listen          = 0.0.0.0:7423
manifest        = /etc/antfarm/manifest.json
schema          = toolreg/2
```

## antc

`antc` has no config file. It reads `ANTC_MANIFEST` from the environment and defaults to `http://toolreg.hm.internal:7423/manifest.json`.

## inference (3.0+)

```
[inference]
split           = 1          # shards; see Distributed_Inference_Notes
shard_hosts     = forager-07,forager-09,forager-12,forager-14
warmup_wait     = true
act_encoding    = base64     # the only value that was ever implemented
```

## Reloading

`SIGHUP` reloads `queen`, `forager`, `toolreg`. `phero` and `cmsync` need a restart; `phero` keeps its replay log across restarts, `cmsync` does a full resync on start.

## See also

- [[Worker_Node_Registry]]
- [[Orchestrator_Recovery]]
- [[Getting_Started#Local_setup]]
