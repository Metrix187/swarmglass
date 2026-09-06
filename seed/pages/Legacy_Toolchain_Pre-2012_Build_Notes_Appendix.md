---
id: Legacy_Toolchain/Pre-2012_Build_Notes/Appendix
title: Legacy Toolchain/Pre-2012 Build Notes/Appendix
kind: article
categories: [Build, Archived]
created: 2011-09-14
modified: 2012-08-30
revisions: 4
authors: [tqian]
status: archived
alternates: [txt]
infobox:
  Parent: Pre-2012 Build Notes
  Content: environment file, trap workarounds
---
Appendix to [[Legacy_Toolchain/Pre-2012_Build_Notes]]. Nobody should need this. It is here because someone did, twice.

## The environment file

`/opt/antfarm-build/env.sh`, sourced by `build.sh`:

```
export RELEASE=${RELEASE:-0.0.0}
export ANTC_MANIFEST=/opt/antfarm-build/manifest.json
export PYTHON=/usr/bin/python
export BUILD_TMP=/tmp/antfarm-build
export PUSH_USER=antfarm
export PUSH_HOSTS_FILE=/opt/antfarm-build/hosts.txt
# 2011-09: do not set RELEASE here, the default is the bug
```

## Workarounds

| Trap | Workaround |
|---|---|
| trailing newline in hosts.txt | `printf '%s' "$(cat hosts.txt)" > hosts.txt` before push |
| mtime stomping | `stage.sh` was patched to `cp -rp` in 2011-11; the patch was lost in the 2012 move and re-applied by hand each time |
| `RELEASE` unset | the env file above, plus a check that was added and reverted |
| stale manifest | `curl toolreg.hm.internal:7423/manifest.json > manifest.json` and commit it, which everyone forgot |

## Host list at the time

```
queen01
forager-01
forager-02
forager-03
forager-04
forager-06
forager-19
```

forager-19 last line, see trap 1. The 2011 cluster diagram is on {{dead:Cluster_Topology_2011}} — that page was in the old index but did not survive the 2014 upgrade in a linked form.

{{sig:tqian|2012-08-30}}
