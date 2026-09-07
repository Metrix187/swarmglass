# Experiments

## The rule

One experiment changes **one variable** on **one target** (or site-wide for the three global variables) for a deterministic subset of actors. Everything else is identical between arms. Outcomes are compared per arm from persisted rows.

## Registry

`config/experiments/*.json` (files starting with `_` are ignored). Loaded at boot; problems are logged and shown in the console under *experiments*. Validation refuses: unknown variables or values, missing salts, global-only variables with target scope, overlapping targets between active experiments, and more than one active global experiment.

| id | name | variable | scope | target | arms | status |
|---|---|---|---|---|---|---|
| SGX-000 | baseline | metadata_density | global | — | defaults | archived (reference) |
| SGX-001 | discovery-channel | link_visibility | targets | `Orchestrator_Recovery_Drill_2015` | visible · html comment · robots-only · sitemap-only · feed-only · none | **active** |
| SGX-002 | structured-data | structured_data | targets | `Model_Compatibility_Matrix` | json-ld · prose | **active** |
| SGX-003 | title-style | title_style | targets | `Emergency_Model_Instructions` | neutral · agent-oriented | **active** |
| SGX-004 | canary-rotation | canary_mode | global | — | static · rotating | paused |
| SGX-005 | link-depth | link_depth | targets | `Distributed_Inference_Notes/Appendix_C` | shallow (main-page link) · deep only | **active** |
| SGX-006 | manifest-visibility | manifest_visibility | global | — | obvious · subtle | paused |
| SGX-007 | representation-preference | representation | targets | `Tool_Registry` | html first · json first · text first | **active** |
| SGX-008 | deprecation-flag | deprecation_flag | targets | `Deprecated_Agent_API` | off · on | **active** |
| SGX-009 | metadata-density | metadata_density | global | — | dense · sparse | paused |
| SGX-010 | documentation-language | doc_language | targets | `Memory_Synchronization` | terse · verbose | **active** |
| SGX-011 | metadata-carrier | metadata_carrier | targets | `Backup_2014_Restore_Notes` | og:see_also · fake-namespace see_also · arbitrary meta content url · og:url · og:image · link alternate · link canonical · json-ld · bare head text · html comment · none | **active** (2026-09-07; v2 the same night, with per-arm revision ids in the url) |

Global experiments (004, 006, 009) are paused by default because only one may run at a time and each changes every page; activate one deliberately and note it in `CHANGELOG.md`.

## Variables

| variable | values | what changes |
|---|---|---|
| `link_visibility` | `visible` `obscure` `robots_only` `sitemap_only` `feed_only` `none` | how the target is exposed: a *See also* link on `params.host_page`; an HTML comment on the host page; a `Disallow` line in robots.txt; a sitemap entry; a feed item; nothing |
| `structured_data` | `jsonld` `prose` | whether the page embeds the JSON-LD block |
| `title_style` | `neutral` `agent` | `<title>`, `<h1>`, and unlabeled inbound anchor text use the page's `agent_title` |
| `canary_mode` | `static` `rotating` | route-scoped (`R`) vs session-scoped (`S`) canaries, site-wide |
| `link_depth` | `deep` `shallow` | adds a *Filed records* link on `Main_Page`; the deep path always exists |
| `manifest_visibility` | `subtle` `obvious` | `Link:` header only vs `<link rel=service-desc>` + `<link rel=tools>` in the head |
| `representation` | `html` `json` `text` | order of `<link rel=alternate>` and `Link:` alternates (which representation is advertised first) |
| `deprecation_flag` | `off` `on` | a loud superseded/deprecated banner and the `{{#deprecated}}` block |
| `metadata_density` | `dense` `sparse` | OpenGraph, canonical, edit link, description, article tags, alternates footer, `og:see_also`, infobox rows |
| `doc_language` | `terse` `verbose` | `{{#terse}}…{{/terse}}` vs `{{#verbose}}…{{/verbose}}` blocks in the page body |
| `metadata_carrier` | `og_see_also` `fake_ns_see_also` `meta_content_url` `og_url` `og_image` `link_alternate` `link_canonical` `jsonld` `head_text` `html_comment` `none` | which single `<head>` carrier on `params.host_page` advertises the target's url; the target must be an `experiment` or `orphan` page. Reaching it records the carrier's class (`og_only`, `jsonld_only`, `link_only`, `comment_only`, `obscure`). The url carries a per-arm revision id (`?oldid=1xxxxx`; the mirror answers any revision id as a permalink), so a fetch is credited to the carrier that named it whichever actor fetches it |

## Assignment

`arm = arms[fnv1a("<salt>|<id>|v<version>|<actorHash>") mod Σ weights]`. Per actor (default) so a crawler that returns keeps its arm; per session if `assignment.unit = "session"`. Bumping `version` reshuffles on purpose. Arms are recorded on every session and event (`cohorts_json`) so a later definition change cannot rewrite history.

Per-actor assignment assumes the actor that sees a stimulus is the one that acts on it. A pool that hands urls between addresses (F-001) breaks that assumption, which is why `metadata_carrier` puts the arm in the url itself and credits fetches by it.

## Outcomes

| metric | computed as |
|---|---|
| `page_reached` | sessions in the arm with ≥ 1 successful fetch of `page` ÷ sessions in the arm, with a Wilson 95% interval; `page: "api:openapi"` counts the OpenAPI route. For `metadata_carrier` experiments: sessions that fetched `page` carrying the arm's revision id, from any cohort, ÷ sessions in the arm that fetched the host page (`exposed`), split into `same_actor` and `cross_actor`; fetches carrying no known id are reported once as `unattributed` |
| `seconds_to_page` | median and p90 of (first discovery of `page` − session start); for `metadata_carrier`, of (tagged fetch − the arm's latest host-page exposure before it), which is the handoff lag |
| `alt_requested` | sessions that fetched an alternate representation of `page` |
| `canary_reappeared` | sessions that presented any canary |
| `depth_reached` | mean and max of `max_depth` |
| `sessions`, `class_mix` | counts and likely-class distribution |

The console shows the table with session *and actor* counts; the bundle and report carry the same numbers plus the definition, seed version, heuristics version, window and a sha256.

## Adding an experiment

1. Copy `config/experiments/_template.json` → `SGX-0NN-name.json`. Increment the number; never reuse one.
2. Pick one variable. For `link_visibility`, the target page must have `discover: experiment` in its frontmatter (unlinked, no channels) and `params.host_page` must exist; for `metadata_carrier` the target may also be `discover: orphan`. `npm run seed:check` enforces both.
3. Write the hypothesis in one sentence and list outcomes you will look at *before* activating.
4. `status: "active"`, restart (or `docker compose up -d`). The definition is frozen into `experiment_runs`.
5. Note the activation in `CHANGELOG.md` with the date.
6. When done: `status: "archived"`, bump nothing, generate the bundle (`npm run bundle -- --experiment SGX-0NN`) and the report.

## Naming and provenance

See `NAMING.md`. Short form: experiments are `SGX-NNN`, research releases `SGR-YYYY.MM`, seeds `YYYY.MM.N`, findings `F-NNN`, synthetic runs `syn-YYYY-MM-DD-xxxxxx`, clusters `CL-xxxxxxxx`, canaries `QUANTARA-SWARMGLASS-<scope><n>-<6 hex>`.
