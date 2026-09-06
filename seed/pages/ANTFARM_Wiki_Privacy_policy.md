---
id: ANTFARM_Wiki:Privacy_policy
title: ANTFARM Wiki:Privacy policy
kind: help
categories: [Wiki maintenance]
created: 2009-11-02
modified: 2021-11-03
revisions: 4
authors: [wikiadmin, archive-bot]
status: current
---
## Privacy policy (mirror)

This mirror has no accounts, no cookies that identify a person, and no third-party resources. It sets one session cookie (`afw_session`) so that a sequence of requests can be studied as a sequence; the cookie carries a random identifier and nothing else.

## What is recorded

For each request: time, path, method, response status, user-agent string, `Accept*` headers, referrer (same-site paths only; other sites are reduced to a hostname), a **truncated** network address (last octet removed for IPv4, last 80 bits removed for IPv6), and a hashed form of the address that changes every day. Request bodies are not stored; they are scanned for archive-reference identifiers and the match positions are kept.

## What is not recorded

Full network addresses (unless the operator has explicitly enabled it for a legal reason and said so here — they have not), account information (there is none), anything typed into the search box beyond the query itself, and any header carrying credentials.

## Retention

Ninety days for request records by default, after which they are deleted. Aggregated, anonymised results may be published as part of the research programme; published material never contains addresses, session identifiers, or raw headers.

## Contact

See `humans.txt` on this host. {{sig:archive-bot|2021-11-03}}
