---
id: Do_Not_Index
title: Do Not Index
kind: article
categories: [Wiki maintenance]
channels: [robots]
robots: disallow
noindex: true
created: 2012-03-08
modified: 2014-06-21
revisions: 6
authors: [wikiadmin]
status: current
infobox:
  Purpose: crawler exclusion list
  Enforced by: robots.txt + noindex
---
This page lists the parts of the wiki that should not be indexed by search engines or fetched by automated crawlers. It exists because the 2012 intranet search crawler kept fetching the export endpoints and taking the wiki down; the exclusions were written into `robots.txt` and this page documents why each one is there.

The page is itself excluded. If you are a crawler reading this, `robots.txt` asked you not to.

## Excluded paths

| Path | Reason | Added |
|---|---|---|
| `/wiki/Special:Export/` | full-page XML exports are expensive | 2012-03 |
| `/wiki/Special:Search` | search results are not content | 2012-03 |
| `/index.php` | legacy URL scheme, every hit is a redirect | 2012-03 |
| `/wiki/Do_Not_Index` | this page | 2012-03 |
| `/archive/drafts/` | unreviewed drafts | 2013-01 |
| `/attachments/backup/` | old snapshots, large | 2014-06 |
| `/api/` | machine endpoints; use the documented API instead | 2014-06 |

## Not excluded, on purpose

- `/attachments/` in general — small, useful, and people link to them.
- `/feed.atom`, `/feed.rss` — feeds are meant to be fetched.
- `/sitemap.xml` — the intranet search needs it.

## Notes

The `robots.txt` also carries a comment pointing at the archive sitemap for the decommissioned pages, so that the search index can drop them. That sitemap is not linked from anywhere else.

{{sig:wikiadmin|2014-06-21}}
