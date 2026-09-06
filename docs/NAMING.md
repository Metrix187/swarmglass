# Naming conventions

| thing | pattern | example | notes |
|---|---|---|---|
| experiment | `SGX-NNN` (+ optional lowercase suffix for a re-run with a new definition) | `SGX-001`, `SGX-001b` | never reuse a number; `version` inside the file handles reshuffles |
| experiment file | `SGX-NNN-<kebab-name>.json` | `SGX-005-link-depth.json` | in `config/experiments/`; `_` prefix = ignored |
| research release | `SGR-YYYY.MM` | `SGR-2026.09` | git tag + `research/releases/SGR-YYYY.MM.md` |
| seed version | `YYYY.MM.N` | `2026.09.0` | `seed/VERSION`; bump N for content edits, MM for new pages/channels; canaries change with it |
| heuristics version | integer | `1` | `config/heuristics.json › version`; bump on any rule or weight change |
| finding | `F-NNN-<kebab-slug>.md` | `F-000-pipeline-validation.md` | `docs/findings/` |
| canary | `QUANTARA-SWARMGLASS-<scope><n>-<6 hex>` | `QUANTARA-SWARMGLASS-R7-4F91C2` | scope `R` route · `S` session · `E` experiment · `C` campaign · `X` external; `n` = route/experiment/campaign number |
| synthetic run | `syn-YYYY-MM-DD-<6 hex>` | `syn-2026-09-05-3f1a9c` | self-registered from tagged traffic |
| cluster | `CL-<8 hex>` | `CL-9a01bb27` | regenerated every 5 min; ids are not stable across runs |
| public export | `swarmglass-dataset-<level>-<date>/` | `swarmglass-dataset-public-2026-10-01/` | |
| report | `<SGX-NNN|observations>-<date>/` | `SGX-001-2026-10-01/` | |
| bundle | `SGX-NNN-bundle-<level>-<date>.json` | | |
| sanitized ids in exports | `S-NNNN` sessions, `A-NNNN` actors | | per export, never cross-joinable |
| wiki page id | `Title_Case_With_Underscores`, namespaces `Talk:`, `Archive:`, `User:`, `Help:`, `ANTFARM_Wiki:`, subpages with `/` | `Distributed_Inference_Notes/Appendix_C` | the URL is `/wiki/<id>` |
| discoverability class | `visible` · `obscure` · `comment_only` · `<channel>_only` · `multi_channel` · `orphan` · `experiment` | | channels: `robots sitemap feed jsonld og header manifest api index stale_index link` |
| resource kind | `page special alt api manifest robots sitemap feed attachment asset redirect missing gone index stale_index other` | | |
| likely class | `human_browser search_bot naive_crawler aggressive_crawler scripted_agent retrieval_agent tool_discovery_agent unknown` | | behavioural, never identity |
| env vars | `SWARMGLASS_*` | | all of them; see `.env.example` |
| console routes | `/api/<noun>` | | JSON only; the SPA is hash-routed |

## Commit style

Lowercase, plain, human. Say what changed and why it matters. Experiment activations and deactivations get their own commit with the date in the message. Seed edits mention the pages. Heuristics edits mention the rule ids.
