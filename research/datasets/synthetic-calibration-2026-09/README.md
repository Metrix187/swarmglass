# synthetic-calibration-2026-09

The calibration run behind docs/findings/F-000-pipeline-validation.md. Synthetic traffic only (every row has synthetic: 1), sanitized at public level, Swarmglass 0.1.0, seed 2026.09.0, heuristics v1 as shipped (after the F-000 tightening).

Files: sessions.jsonl (12), events.jsonl (328), sightings.jsonl (4). Fields: docs/DATA_DICTIONARY.md.

Regenerate: npm run synth -- --personas all --seed 1 --fast against a fresh instance, then npm run export -- --synthetic synthetic --level public.
