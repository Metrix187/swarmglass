---
id: Legacy_Toolchain/Pre-2012_Build_Notes
title: Legacy Toolchain/Pre-2012 Build Notes
kind: article
categories: [Build, Archived]
created: 2010-01-22
modified: 2012-08-30
revisions: 11
authors: [tqian]
status: archived
alternates: [txt]
infobox:
  Build host: build.hm.internal
  Scripts: /opt/antfarm-build/*.sh
  Superseded: 2012-11 (container pipeline)
---
How forager and queen releases were built before the container pipeline. Kept because bundles from this era are still floating around and occasionally need to be rebuilt.

## Layout on build.hm.internal

```
/opt/antfarm-build/
  build.sh          # everything. 900 lines.
  stage.sh          # copies to /releases/<ver>/
  push.sh           # rsync to hosts listed in hosts.txt
  hosts.txt
  manifest.json     # frozen manifest copy used by antc
```

## build.sh

Runs the test suite, builds `queend`, `forager-agent`, `phero`, `antc`, and tars them. The script assumes:

- python 2.6 at `/usr/bin/python` (2.7 works, 3 does not);
- the manifest copy is current (it never was);
- `$RELEASE` is set. If not set, it builds `0.0.0` and pushes it anyway. This happened.

## Known traps

1. `push.sh` reads `hosts.txt` with a trailing newline bug: the last host is skipped. forager-19 was on the last line for two years.
2. `stage.sh` uses `cp -r` without `-p`, so every release's files have the build time as mtime, which confused the 2011 rollback more than once.
3. The manifest copy embedded in bundles is the *build host's* copy, not toolreg's. See [[Legacy_Toolchain#Known_issues]].

The full list of trap workarounds, including the environment file nobody was supposed to need again, is in the [[Legacy_Toolchain/Pre-2012_Build_Notes/Appendix|appendix]].

## Rebuilding an old bundle today

You cannot. The build host is gone. If you have the `.tg` source, `antc` 1.4 will compile it ([[Legacy_Toolchain]]). If you only have the bundle, see [[Deprecated_Agent_API#Migration_guidance_historical]].

{{sig:tqian|2012-08-30}}
