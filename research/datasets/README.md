# Datasets

Public, sanitized exports that accompany research releases. Each folder is produced by `npm run export -- --level public` (or, for calibration sets, by the synthetic runner) and contains:

- `sessions.jsonl` — one session per line
- `events.jsonl` — one request per line, joined to sessions by `session`
- `sightings.jsonl` — canary sightings
- `README.md` — level, window, traffic kind, counts, Swarmglass version
- `SHA256SUMS`

Fields are documented in `docs/DATA_DICTIONARY.md` (section *Export fields*). Session and actor labels (`S-0001`, `A-0001`) are assigned per export and cannot be joined across folders.

## Kinds

| prefix | contains | may be published |
|---|---|---|
| `synthetic-calibration-*` | only tagged synthetic traffic from the personas in `src/synth/personas.ts` | yes; it is test data and says so in every row (`synthetic: 1`) |
| `swarmglass-dataset-public-*` | real traffic at public sanitization level | yes |
| `swarmglass-dataset-internal-*` | real traffic with truncated prefixes and user-agent strings | **never** — these do not belong in this folder and the sanitizer will not put them here |

## Current

- `synthetic-calibration-2026-09/` — the calibration run behind F-000 (regenerate with `npm run synth -- --personas all --seed 1` against a fresh instance, then `npm run export -- --synthetic synthetic --level public`).

Real-traffic datasets arrive with SGR-2026.10 or later.
