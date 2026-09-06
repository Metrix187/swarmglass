# quantara.cv integration

Three static files and two edits, all in the site repo at `D:\quantara-site`, deployed with the site's own tooling. Nothing here touches the honeypot; the two systems share a DNS zone and a visual language, not state.

## Files (staged in `D:\quantara-site\site\`)

| path | what |
|---|---|
| `site/projects/swarmglass/index.html` | the overview page: what it is, why, how it works, how to read the numbers, ethics, reproduce. rose editorial skin, no external requests, inline svg only. |
| `site/swarmglass/index.html` | a `<meta refresh>` stub so `quantara.cv/swarmglass/` reaches the mirror. the cPanel `.htaccess` is off limits, so this is the only redirect available. `noindex`. Live since 2026-09-06, once the subdomain resolved. |
| `site/index.html` | one new row in the tools index (08 · swarmglass) linking to `/projects/swarmglass/` |
| `site/sitemap.xml` | entries for `/projects/swarmglass/` and `/swarmglass/` |

The same files are kept in this repo under `quantara-site/site/` as the source of truth for the page; edit here, copy over, push there.

## Deploy

```bash
cd /d/quantara-site
git status                         # a dirty tree you didn't make = someone edited by hand; ask first
python deploy/push.py --dry-run    # look
python deploy/push.py              # ship; it purges the nginx cache and verifies the live bytes
```

`push.py` is not done until the live bytes match. If verification fails, the manifest is left untouched and the next push retries.

## Homepage row

Added to the `#tools` index after row 07 (`base64 → glb`):

```html
<a class="trow" href="/projects/swarmglass/">
  <span class="tno">08</span>
  <span class="tname">swarmglass</span>
  <span class="tdesc">a forgotten-looking wiki that watches what crawlers and agents read, and keeps very good notes.</span>
  <span class="tmeta">research · passive · reproducible</span>
</a>
```

When the first observational finding lands, it gets a card in `#think` like any other article, generated with `npm run article` from the report folder and edited by hand.

## Why not `quantara.cv/swarmglass` as the app itself (option B)

The apex is a no-shell cPanel host: no reverse proxy, no `.htaccess` edits, no long-running processes. The app supports a base path (`SWARMGLASS_BASE_PATH=/swarmglass`) and `deploy/caddy/Caddyfile.optionB` is ready, but there is no proxy on that host to put it behind. The subdomain on the Oracle VM is the clean, isolated, reversible choice; the stub keeps the short URL alive.

## Checklist before pushing

- [ ] `site/projects/swarmglass/index.html` opens in a browser with an empty network tab (only `/logo.svg` and `/pup.svg`, same-origin)
- [ ] the homepage row renders in the index grid on mobile widths
- [ ] `sitemap.xml` is valid XML
- [ ] the mirror is actually live at `swarmglass.quantara.cv` before the stub goes up (or the stub's refresh lands on nothing)
