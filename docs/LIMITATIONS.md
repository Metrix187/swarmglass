# Limitations

What the instrument cannot see, what it can mistake, and what a reader should not conclude.

## Identity

- **No model identity.** Nothing in an HTTP request says which model, if any, produced it. User-agent strings are self-declared and often shared by tooling that has nothing to do with the name in them. Publications never claim "model X did Y".
- **No operator identity.** A cluster with strong coordination signals is a group of sessions that behaved as if coordinated. It could be one operator with a fleet, several unrelated tools with the same defaults, or a CDN's prefetchers.
- **Actor ≠ machine ≠ person.** The actor fingerprint is a truncated network prefix plus a user-agent. One corporate NAT is one actor; one laptop switching user-agents is several.

## Sessions

- Cookie-less clients are sessioned by fingerprint within a 30-minute idle window. Two crawlers from one /24 with the same user-agent merge; one crawler that pauses 31 minutes splits. Both directions are visible in the data (merged sessions look implausibly concurrent; split sessions share an actor) and both bias pacing and depth features.
- The idle window and the actor definition are documented choices, not truths. Changing them changes counts.

## Discovery attribution

- `referer:` attribution is certain only when the client sends a referer. Many do not; then the pipeline falls back to *channel* (did the session fetch the machine list that names the page?) and *sequence* (did it follow a page within 60 s?). `unknown:<class>` means a hidden page was reached with no observed path — prior knowledge, a guess, an index we do not serve, or a client that fetched the channel in a different session.
- A page can be in several channels; attribution names one.

## Canaries

- **Route-scoped canaries are the same for everyone.** A sighting of an `R` canary by a session that was never exposed means the string arrived from *somewhere* — a cache, another client, a search index, a model's memory — and the instrument cannot say which. Session-scoped (`S`) canaries remove that ambiguity but are only issued under the rotating arm.
- Canaries are found by regular expression. A client that rewrites, truncates or hashes what it read leaves no sighting.
- Exposure counts what was *served*, not what was *read*. A crawler that fetched a page and discarded the `<meta>` tag was still "exposed" to the meta canary.

## Heuristics

- The rules are hand-written and calibrated on nine caricature personas. They separate the caricatures well (see `findings/F-000`) and will misfile real traffic that mixes behaviours. The evidence list exists so that a reader can disagree with a label.
- `unknown` is the honest answer for short sessions, which are most sessions.
- Weights are not learned from ground truth because there is no ground truth. Do not read a class probability as a calibrated probability.

## Experiments

- Arms are balanced in expectation over actors, not over sessions or over "kinds of visitor". Small-n comparisons are reported with Wilson intervals and will be wide.
- Sessions from one actor are correlated. The actor count next to each arm is the effective sample size ceiling.
- Effects are of *this* site's affordances on *this* window's traffic. The fiction, the era styling and the domain all shape who arrives.

## The instrument itself

- The site is on one host behind one proxy; a regional outage is a gap in the data, not a behavioural signal.
- Rate limiting (30 rps per prefix) shapes the tail of aggressive sessions; the 429s are recorded so the shaping is visible.
- Anything in front of the honeypot (a CDN, a WAF) changes the population. See `deploy/cloudflare.md`.
- Retention is 90 days. Longitudinal claims need the sanitized exports, which lose resolution on purpose.

## What a reader should not conclude

- That a class label is an identification.
- That a cross-session canary sighting proves a shared memory rather than a shared cache.
- That a difference between arms without an interval is a difference.
- That absence of a behaviour in our data is absence of the behaviour. The site is small and strange; many systems never find it.
