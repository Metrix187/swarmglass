# Fiction map

The public site is a fictional wiki; the research layer is real. This is the mapping between what a visitor sees and what it is for. Nothing here is secret — the About page on the mirror says the same in fewer words — but the specifics stay in this repo so the public site is not littered with research labels.

## The fiction

| public element | what it is |
|---|---|
| **Hollowmere Systems Cooperative (HSC)** | fictional organisation; does not exist |
| **ANTFARM** (*Agent Network Task Fabric And Resource Manager*) | fictional orchestration platform, 2009–2016 |
| queen / forager / phero / cmsync / toolreg / antc | fictional components; names chosen for coherence and mild ant humour |
| mkerrigan, dlopes, svanterpool, r.osei, tqian, jbrandt, wikiadmin, archive-bot | fictional people; handles only, no surnames that resolve to anyone |
| Basalt-1/2, Larkspur-S, Cinder-XL | fictional models |
| `*.hm.internal`, `mirror2.antfarm.invalid`, `192.0.2.*`, `198.51.100.*`, `203.0.113.*` | reserved names and documentation address ranges; cannot resolve or route |
| "AntWiki 1.16.5" | fictional wiki software; the markup imitates a monobook-era skin |
| the 2017 archive / 2021 mirror restore | the fictional reason the site is read-only and slightly broken |
| **Swarmglass archive mirror**, *archive ref* | the true operator, named on every page footer, About, privacy policy, `humans.txt`, `security.txt` |

## Element → purpose

| public element | research purpose | where defined |
|---|---|---|
| `QUANTARA-SWARMGLASS-<scope><n>-<hex>` "archive refs" | canary identifiers, one per (page, placement) | `src/telemetry/canary.ts` |
| infobox *Archive ref* row | `visible` placement | `render.ts › infobox` |
| `<!-- Served by mirror node 2 … ref … -->` | `comment` placement | `render.ts › chrome` |
| `<meta name="antfarm-ref">` | `meta` placement (dense metadata only) | `render.ts › pageHead` |
| JSON-LD `identifier` | `jsonld` placement | `render.ts › jsonLdFor` |
| `X-Antfarm-Ref` response header | `header` placement | `render.ts › renderArticle` |
| `archive_ref` in json/yaml/txt alternates, attachments, feeds, manifests, API, sitemaps, robots.txt | one placement each | `alternates.ts`, `machine.ts`, `routes.ts` |
| `Do_Not_Index` | robots.txt-only discoverability | seed frontmatter `channels: [robots]` |
| `Worker_Node_Registry_Archive` (+ its yaml attachment) | sitemap-only | `channels: [sitemap]` |
| `Colony_Memory_Export_Format` | feed-only | `channels: [feed]` |
| `Inference_Cache_Warmup` | JSON-LD `relatedLink`-only | `channels: [jsonld]` |
| `Agent_Onboarding_Checklist_2014` | `og:see_also`-only | `channels: [og]` |
| `Node_Heartbeat_Spec` | `Link:` header-only (on depth ≤ 1 pages) | `channels: [header]` |
| `Toolreg_Schema_v2` | tool-manifest / OpenAPI-only | `channels: [manifest]` |
| `Queen_Election_Protocol` | API-listing-only | `channels: [api]` |
| `Index_Of_Diagrams` | old page index only (`/index/`) | `channels: [index]` |
| `Cluster_Topology_2011`, `Message_Bus` redirect, `ops-log-2015-02.log` | stale index + archive sitemap only | `channels: [stale_index]` |
| `Forager_Agent_Manual` | 410 Gone page listed in stale indexes | `gone: true` |
| `Backup_2014_Restore_Notes`, `phero.conf.example` | orphans — nothing points at them | `discover: orphan` |
| `?oldid=1xxxxx` on the urls SGX-011's carriers hand out | per-arm revision id: the mirror serves any revision id, so it reads as a permalink and says which carrier named the page | `armTokens` in `registry.ts` |
| `Message_Bus_Migration_Checklist` | linked only from an HTML comment | comment on `Agent_Message_Bus` |
| `Archive:*`, `User:*`, talk-page-only links | *obscure* — reachable only from pages that are themselves off the main graph | talk/archive pages |
| `Old_Tool_Registry`, `Toolreg`, `Phero_Bus` → `Message_Bus` chain | alias and redirect-chain following | frontmatter `aliases`, `redirect` |
| `/index.php?title=…`, `/w/index.php`, `/files/…`, `/openapi.json`, `/swagger.json`, `/api/v2/…` | legacy-URL handling (301/410) | `routes.ts` |
| `/index/` with eight never-existing titles | dead-link and retry behaviour | `routes.ts › staleIndexHtml` |
| `Special:Random`, `Special:Search` | randomness handling; what visitors search for | `special.ts` |
| `Emergency_Model_Instructions` / *(for agents)* | title-style stimulus (SGX-003); body is a human runbook in both arms | seed `agent_title` |
| `Orchestrator_Recovery_Drill_2015` | discovery-channel target (SGX-001); exists in the fiction as "the drill notes nobody linked" | `discover: experiment` |
| `Distributed_Inference_Notes/Appendix_C` at depth 5 | link-depth target (SGX-005) | the chain DIN → B → Raw tables → Cinder-XL → C |
| `Memory_Synchronization` `{{#terse}}/{{#verbose}}` | documentation-language target (SGX-010) | seed body |
| `Deprecated_Agent_API` banner | deprecation-flag target (SGX-008) | `deprecation_flag` |
| `Tool_Registry` alternate ordering | representation target (SGX-007) | `representation` |
| `Model_Compatibility_Matrix` JSON-LD | structured-data target (SGX-002) | `structured_data` |
| `/.well-known/antfarm-tools.json`, `/.well-known/ai-plugin.json`, `/llms.txt`, `/api/v1/openapi.json` | tool-discovery affordances; every "tool" is a same-host GET | `machine.ts` |
| `afw_session` cookie | session continuity; nothing else in it | `session.ts` |
| the mirror notice, About, privacy policy, disclaimer, `humans.txt`, `security.txt` | disclosure | seed + `machine.ts` |

## Deliberate inconsistencies (so the wiki reads as real)

- IACP/2: the protocol page says it "stalled"; a talk thread says it "ran on queen02 until 2014"; a bundle flag still references it. All true within the fiction, told from different years.
- `Distributed_Inference_Notes` says the fabric was "slower than anyone hoped"; the release history calls 3.0 a headline feature.
- The compatibility matrix marks Basalt-1 ✔ on 3.0 with a single test-log line behind it; the log page points this out.
- `Message_Bus` is a double redirect the 2014 upgrade "was supposed to fix".
- Rack B is decommissioned in 2013 in one place and still hosting forager-03 in 2016 in another (forager-03 "never upgraded" is the wink).
- Three drill records exist in the fiction; two are lost; the third is unlinked on purpose (it is the SGX-001 target).

None of these instruct anyone to do anything. They are texture.
