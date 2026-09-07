import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateIp, cidrContains, inAnyCidr } from '../src/util/ip.ts';
import { negotiate, acceptProfile } from '../src/http/negotiate.ts';
import { entropy, jaccard, ngrams, scrub } from '../src/util/text.ts';
import { fnv1a, seededRandom, safeEqual } from '../src/util/hash.ts';
import { normalizePath, resolveClientIp } from '../src/http/server.ts';
import { malformationFlags } from '../src/http/security.ts';
import { fmtDuration } from '../src/util/time.ts';

test('ip truncation keeps the prefix only', () => {
  assert.equal(truncateIp('203.0.113.77'), '203.0.113.0/24');
  assert.equal(truncateIp('::ffff:198.51.100.9'), '198.51.100.0/24');
  assert.equal(truncateIp('2001:db8:abcd:1234:5678:9abc:def0:1'), '2001:db8:abcd::/48');
  assert.equal(truncateIp('not an ip'), null);
});

test('cidr matching', () => {
  assert.ok(cidrContains('10.0.0.0/8', '10.42.1.1'));
  assert.ok(!cidrContains('10.0.0.0/8', '11.0.0.1'));
  assert.ok(cidrContains('::1/128', '::1'));
  assert.ok(cidrContains('2001:db8::/32', '2001:db8:1::5'));
  assert.ok(inAnyCidr(['127.0.0.1/32', '::1/128'], '127.0.0.1'));
  assert.ok(!inAnyCidr(['127.0.0.1/32'], '::1'));
});

test('trusted proxy resolution walks x-forwarded-for from the right', () => {
  const trusted = (ip: string) => inAnyCidr(['10.0.0.0/8', '127.0.0.1/32'], ip);
  assert.equal(resolveClientIp('127.0.0.1', { 'x-forwarded-for': '198.51.100.7, 10.0.0.5' }, { trustProxy: true, isTrusted: trusted }), '198.51.100.7');
  assert.equal(resolveClientIp('203.0.113.1', { 'x-forwarded-for': '198.51.100.7' }, { trustProxy: true, isTrusted: trusted }), '203.0.113.1', 'untrusted peer cannot spoof');
  assert.equal(resolveClientIp('127.0.0.1', { 'cf-connecting-ip': '198.51.100.9' }, { trustProxy: true, isTrusted: trusted }), '198.51.100.9');
});

test('accept negotiation honours q values and specificity', () => {
  assert.equal(negotiate('text/html', ['text/html', 'application/json']), 'text/html');
  assert.equal(negotiate('application/json, text/html;q=0.5', ['text/html', 'application/json']), 'application/json');
  assert.equal(negotiate('*/*', ['text/html', 'application/json']), 'text/html');
  assert.equal(negotiate('text/*', ['application/json', 'text/plain']), 'text/plain');
  assert.equal(negotiate('application/xml', ['text/html']), null);
  assert.equal(acceptProfile('application/json'), 'json');
  assert.equal(acceptProfile('*/*'), 'any');
  assert.equal(acceptProfile(undefined), 'none');
});

test('path normalisation removes traversal', () => {
  assert.equal(normalizePath('/wiki/../../etc/passwd'), '/etc/passwd');
  assert.equal(normalizePath('//wiki///Main_Page/'), '/wiki/Main_Page');
  assert.equal(normalizePath('/'), '/');
});

test('malformation flags', () => {
  const f = malformationFlags('/wiki/../x?a=<script>', { host: 'h' }, 'GET');
  assert.ok(f.includes('dot_dot'));
  assert.ok(f.includes('html_chars_in_url'));
  assert.ok(f.includes('no_user_agent'));
  assert.ok(f.includes('probe_pattern'));
  assert.deepEqual(malformationFlags('/wiki/Main_Page', { host: 'h', 'user-agent': 'x' }, 'GET'), []);
});

test('text helpers', () => {
  assert.equal(entropy(['a', 'a', 'a', 'a']), 0);
  assert.ok(Math.abs(entropy(['a', 'b']) - 1) < 1e-9);
  assert.equal(jaccard(new Set([1, 2]), new Set([2, 3])), 1 / 3);
  assert.deepEqual(ngrams(['a', 'b', 'c'], 2), ['a → b', 'b → c']);
  assert.equal(scrub('okbad', 100), 'ok�bad');
  assert.equal(scrub('x'.repeat(10), 5).length, 5);
});

test('hash helpers', () => {
  assert.equal(fnv1a('abc'), fnv1a('abc'));
  assert.notEqual(fnv1a('abc'), fnv1a('abd'));
  const r1 = seededRandom(7);
  const r2 = seededRandom(7);
  assert.equal(r1(), r2());
  assert.ok(safeEqual('a', 'a'));
  assert.ok(!safeEqual('a', 'b'));
  assert.ok(!safeEqual('a', 'ab'));
});

test('fmtDuration carries seconds into minutes instead of printing 3m 60s', () => {
  assert.equal(fmtDuration(239_600), '4m 0s');
  assert.equal(fmtDuration(150_000), '2m 30s');
  assert.equal(fmtDuration(59_990), '1m 0s');
  assert.equal(fmtDuration(3_599_600), '1h 0m');
  assert.equal(fmtDuration(2_500), '2.5s');
});
