---
id: Colony_Memory_Export_Format
title: Colony Memory Export Format
kind: article
categories: [Storage, Reference]
channels: [feed]
created: 2012-11-08
modified: 2014-09-03
revisions: 6
authors: [mkerrigan, archive-bot]
status: current
alternates: [yaml, txt, json]
infobox:
  Tool: cmsync snapshot
  Extension: .snap (tar of yaml)
  Compression: none
---
Format of `cmsync snapshot` output. The page lost its inbound links in the 2014 wiki upgrade and lives on only in the changes feed, because archive-bot touched it during the mirror import.

## Layout

A `.snap` file is an uncompressed tar:

```
manifest.yaml        # snapshot metadata
keys/
  00/                # first two hex chars of sha1(key)
    <sha1>.yaml      # one file per key
```

## manifest.yaml

```yaml
snapshot: 2016-01-04T02:00:00Z
queen: queen01
epoch: 131
keys: 1184402
bytes: 44011230100
format: cmsnap/1
```

## key file

```yaml
key: cm://index/latest
stamp: {q1: 9912, q2: 9877}
written: 2016-01-03T23:41:08Z
writer: forager-15
sha1: 3e1f...
encoding: raw          # raw | base64
value: |
  ...
```

Values over 1 MiB are stored base64 with `encoding: base64`. This doubles the size of exactly the values that were already too big.

## Restoring

`cmsync restore --from file.snap --into queen01`. Restores stamps as-is, so a restore onto a queen with *newer* stamps loses silently. The 2014 restore notes cover this and were, as far as anyone knows, never linked from anywhere.

## See also

- [[Memory_Synchronization]]
- {{attachment:cmsync-snapshot-sample.yaml}}
