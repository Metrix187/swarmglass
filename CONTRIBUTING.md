# Contributing

Swarmglass is a small research instrument with sharp edges. Contributions that keep it small, passive and legible are welcome.

## Ground rules

1. **Passive stays passive.** No outbound requests, no code that acts on a visitor's input beyond serving a page, no instructions addressed to visitors in the seed. A PR that adds a fetch to the public path will be closed with thanks.
2. **No new runtime dependencies** without a written reason in the PR. The whole surface is meant to be readable in an afternoon.
3. **Privacy is a design, not a setting.** New telemetry fields need a line in `docs/PRIVACY.md` and an allowlist entry in `src/publish/sanitize.ts` before they can appear in an export — by default they cannot.
4. **Fiction stays fictional.** New seed pages use the existing people, hosts (`*.hm.internal`), address ranges (RFC 5737) and models. No real names, products, companies, or resolvable hosts. Run `npm run seed:check`.
5. **One variable per experiment.** See `docs/EXPERIMENTS.md`. Number experiments; never reuse a number.
6. **Labels are heuristics.** Rule changes go in `config/heuristics.json` with a version bump, a note, and a look at the synthetic confusion matrix before and after.

## Workflow

```bash
npm install
npm run check          # types
npm test               # unit + end-to-end over http (in-memory db, ephemeral ports)
npm run seed:check     # seed lint + discoverability census
npm run dev            # then poke http://localhost:8080 and http://localhost:8081
```

- TypeScript in the *erasable* subset (no enums, no parameter properties, no namespaces): Node runs the source directly.
- Relative imports carry the `.ts` extension.
- Tests use `node:test`; put end-to-end checks in `tests/server.test.ts`.
- Comments explain *why*. Commit messages are lowercase and plain.

## Adding a seed page

Frontmatter fields are documented at the top of `src/wiki/content.ts`. Decide the discoverability on purpose: link it (visible), put it only in a channel (`channels: [feed]`), or leave it unlinked (`discover: orphan`). Add `alternates` if it should have json/txt/yaml forms. Give it categories, authors, created/modified dates, revisions. Keep the era.

## Adding a heuristic rule

Rules are `{ id, when, weight, note }`. `when` is `{f, op, v}` or `all`/`any`/`not` of those. Features are listed in `docs/DATA_DICTIONARY.md`; add a feature in `src/telemetry/features.ts` if none fits, then document it. Bump `version`, run `npm run rescore`, compare the synthetic matrix.

## Reporting a problem

Security: see `SECURITY.md`. Anything else: an issue with the request path, the seed page, or the rule id involved. Never include visitor data from a real instance.
