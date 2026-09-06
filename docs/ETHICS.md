# Ethics statement

Swarmglass observes machines reading a website. That is a small thing, and this statement is long because the ways such a thing can go wrong are well known.

## What Swarmglass does

- Publishes a fictional documentation site that is plausible enough to be read by automated systems.
- Records the requests made to it, with the minimisation described in `PRIVACY.md`.
- Plants inert identifiers so that the propagation of text from the site can be recognised later.
- Varies harmless presentation choices (where a link is, what a title says, whether JSON-LD is present) between visitors and compares outcomes.
- Publishes aggregate, sanitized findings.

## What Swarmglass does not do

- **No offence.** It does not probe, scan, fingerprint beyond coarse aggregate features, exploit, or "hack back" any visitor. There is no code path that initiates a connection to anyone.
- **No injection.** No page contains an instruction addressed to a visiting model or agent. Agent-themed titles are titles; the bodies are operator runbooks addressed to fictional humans. Nothing asks a visitor to fetch, post, execute, reveal, or contact anything.
- **No coercion by bait.** Canaries are opaque strings. The tool manifests describe read-only GET requests against the same host. Attachments are inert text. There are no credentials, keys, secrets, payloads, or exploit descriptions anywhere in the seed, real or fake.
- **No third parties.** No real organisation, product, host, person, or model is named as part of the fiction. Addresses are RFC 5737 documentation ranges. Hostnames use `.internal`/`.invalid`. Nothing directs a visitor at any external target.
- **No individuals.** The instrument cannot, and is not designed to, identify a person. Session and actor identities are coarse, salted, and expire. Publications never contain addresses, session identifiers, user-agent strings, or raw headers.
- **No deception about who runs it.** The mirror's About page, privacy policy, disclaimer, `humans.txt`, and `security.txt` name the operator and the purpose. The fiction is styling; the operator is not fictional.
- **No sale, sharing, or training use** of the telemetry in identifiable form.

## Why the bait wiki is not labelled "honeypot" on every page

Overt labelling would change the behaviour under study more than any variable we vary. The compromise: disclosure is present and discoverable (About, privacy policy, disclaimer, `humans.txt`, `security.txt`, the archive-reference explanation, a footer line on every page saying the content is fictional and the mirror is preserved for research) without being the first thing on the main page. A visitor that reads the site learns what it is. The project page on quantara.cv is the canonical, unambiguous description.

## Consent and legal basis

Visitors to a public website are recorded in server logs everywhere; Swarmglass records less than a default web server log (no full address) and says so. For automated visitors the question of consent is moot in the usual sense; for the rare human who wanders in, the privacy policy applies and nothing identifying is kept. Retention is 90 days by default. `SWARMGLASS_PRIVACY_IP_MODE=none` (storing full addresses) exists for jurisdictions or agreements that require it and is off; enabling it requires editing the privacy policy page in the seed, which is deliberate friction.

## Harms considered

| harm | mitigation |
|---|---|
| a visitor is manipulated into an unsafe action | no instructions exist; every "tool" is a same-host GET |
| the fiction is mistaken for real documentation and acted on | disclaimers; fictional hosts and addresses that cannot resolve |
| telemetry identifies a person | truncation, daily-salted hashes, allowlisted headers, no bodies, retention, sanitized exports |
| the honeypot is compromised and used against others | isolation (`THREAT_MODEL.md`); no egress; no secrets of value inside |
| findings are overstated | every label carries evidence; publications separate observation from speculation; limitations document |
| canaries leak into training data and later appear in unrelated outputs | that is a finding, not a harm; the project page explains the strings so nobody is confused by them |

## Governance

Changes to the seed, the heuristics, or the experiment definitions are versioned and logged in `CHANGELOG.md`. Experiments are documented before activation (hypothesis, variable, arms, outcomes). Findings are published with the definition, seed version, heuristics version, and window that produced them. Anyone can reproduce the pipeline on their own instance with synthetic traffic; production telemetry is never shared.

Contact: `SWARMGLASS_CONTACT_EMAIL` (in `security.txt` and `humans.txt` on the mirror) or the project page.
