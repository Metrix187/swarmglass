/* swarmglass research console — vanilla js, no build, no cdn.
   everything rendered here comes from the json api; every string goes through textContent. */
(function () {
  'use strict';

  // ---------- tiny dom + fetch helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v; // only used with html we generate ourselves (svg)
      // the console's csp has style-src 'self' and no 'unsafe-inline', and a style *attribute* counts as inline:
      // setAttribute('style') was refused on every bar and heat cell, so each bar rendered at full width whatever
      // its value. writing through the cssom is not inline style and is allowed
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) el.setAttribute(k, String(v));
    }
    // flatten all the way down: views hand in map()s of arrays of nodes, and appendChild(array) throws
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }
  const state = { csrf: null, user: null, range: '24h', synthetic: 'real', env: 'development' };
  function qs() { return `range=${encodeURIComponent(state.range)}&synthetic=${encodeURIComponent(state.synthetic)}`; }
  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: opts && opts.body ? { 'content-type': 'application/json', 'x-csrf': state.csrf } : { 'x-csrf': state.csrf } }, opts || {}));
    if (r.status === 401) { location.href = '/login'; throw new Error('unauthenticated'); }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : r.text();
  }
  const fmtTs = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  // whole seconds first, then split. rounding the remainder on its own printed "3m60s"
  const fmtRel = (ms) => { if (ms < 1000) return `${Math.round(ms)}ms`; if (ms < 59950) return `${(ms / 1000).toFixed(1)}s`; const s = Math.round(ms / 1000); return s < 3600 ? `${Math.floor(s / 60)}m${s % 60}s` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`; };
  const pct = (x) => x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
  const num = (x) => (x === null || x === undefined) ? '—' : typeof x === 'number' ? (Number.isInteger(x) ? x.toLocaleString() : x.toFixed(2)) : String(x);
  function tag(text, cls) { return h('span', { class: 'tag ' + (cls || '') }, text); }
  function classTag(c) { const map = { human_browser: 'ok', search_bot: 'lilac', naive_crawler: '', aggressive_crawler: 'bad', scripted_agent: 'rose', retrieval_agent: 'rose', tool_discovery_agent: 'rose', unknown: '' }; return tag((c || 'unscored').replace(/_/g, ' '), map[c] || ''); }
  function bar(v, max, cls) { return h('div', { class: 'bar ' + (cls || '') }, h('i', { style: `width:${max ? Math.min(100, (100 * v) / max) : 0}%` })); }
  function table(cols, rows, opts) {
    const t = h('table', { class: (opts && opts.class) || '' });
    t.appendChild(h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))));
    const tb = h('tbody');
    for (const r of rows) {
      const tr = h('tr', { class: opts && opts.link ? 'rowlink' : '' }, cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : num(r[c.key]))));
      if (opts && opts.link) tr.addEventListener('click', (e) => { if (e.target.tagName !== 'A') location.hash = opts.link(r); });
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    return h('div', { class: 'tablewrap' }, t);
  }
  function card(title, ...body) { return h('section', { class: 'card' }, title ? h('h3', null, title) : null, ...body); }
  function link(hash, text) { return h('a', { href: hash }, text); }
  function sid(id) { return link('#/session/' + encodeURIComponent(id), id.slice(0, 10)); }
  function pageLink(p) { return link('#/page/' + encodeURIComponent(p), p); }
  function kv(obj) { const dl = h('dl', { class: 'kv' }); for (const [k, v] of Object.entries(obj)) { dl.appendChild(h('dt', null, k)); dl.appendChild(h('dd', null, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—'))); } return dl; }
  function note(text) { return h('div', { class: 'note' }, text); }

  // ---------- svg charts ----------
  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v)); return e; }
  function sparkline(series, opts) {
    const W = (opts && opts.width) || 600, H = (opts && opts.height) || 90, pad = 4;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', preserveAspectRatio: 'none' });
    if (!series.length) return svg;
    const max = Math.max(1, ...series.map((p) => p.n));
    const sx = (i) => pad + (i / Math.max(1, series.length - 1)) * (W - 2 * pad);
    const sy = (v) => H - pad - (v / max) * (H - 2 * pad);
    let d = '', de = '';
    series.forEach((p, i) => { d += `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.n).toFixed(1)} `; de += `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.err).toFixed(1)} `; });
    const area = d + `L${sx(series.length - 1).toFixed(1)},${H - pad} L${sx(0)},${H - pad} Z`;
    svg.appendChild(svgEl('path', { d: area, fill: '#D6336C', opacity: 0.12 }));
    svg.appendChild(svgEl('path', { d, fill: 'none', stroke: '#D6336C', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
    svg.appendChild(svgEl('path', { d: de, fill: 'none', stroke: '#C05621', 'stroke-width': 1, 'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke' }));
    const t = svgEl('text', { x: pad + 2, y: 12 }); t.textContent = `peak ${max}/bucket`; svg.appendChild(t);
    return svg;
  }
  function hbars(rows, opts) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    const wrap = h('div');
    for (const r of rows) wrap.appendChild(h('div', { class: 'trait' }, h('span', { class: 'name' }, r.label), bar(r.value, max, opts && opts.cls), h('span', { class: 'val' }, opts && opts.fmt ? opts.fmt(r.value) : num(r.value))));
    return wrap;
  }
  function heatTable(rows, cols, cells, opts) {
    const max = Math.max(1, ...rows.flatMap((r) => cols.map((c) => (cells[r] && cells[r][c]) || 0)));
    const t = h('table', { class: 'matrix' });
    t.appendChild(h('thead', null, h('tr', null, h('th', null, (opts && opts.corner) || ''), cols.map((c) => h('th', null, c.replace(/_only$/, ''))))));
    const tb = h('tbody');
    for (const r of rows) {
      tb.appendChild(h('tr', null, h('th', null, r), cols.map((c) => { const v = (cells[r] && cells[r][c]) || 0; const a = v ? 0.12 + 0.88 * (v / max) : 0; return h('td', { class: a > 0.55 ? 'hot' : '', style: v ? `background: rgba(214,51,108,${a.toFixed(2)})` : '' }, v || ''); })));
    }
    t.appendChild(tb);
    return h('div', { class: 'tablewrap' }, t);
  }
  function forceGraph(nodes, edges, opts) {
    const W = 900, Hh = 360;
    const canvas = h('canvas', { class: 'graph', width: W, height: Hh });
    const ctx = canvas.getContext('2d');
    const pos = new Map(nodes.map((n, i) => [n.id, { x: W / 2 + Math.cos(i) * 120, y: Hh / 2 + Math.sin(i) * 100, vx: 0, vy: 0 }]));
    const idx = new Map(nodes.map((n) => [n.id, n]));
    function step() {
      for (const a of nodes) for (const b of nodes) {
        if (a === b) continue;
        const pa = pos.get(a.id), pb = pos.get(b.id);
        let dx = pa.x - pb.x, dy = pa.y - pb.y; const d2 = dx * dx + dy * dy + 0.01; const f = 1400 / d2;
        pa.vx += dx * f * 0.01; pa.vy += dy * f * 0.01;
      }
      for (const e of edges) {
        const pa = pos.get(e.from), pb = pos.get(e.to); if (!pa || !pb) continue;
        const dx = pb.x - pa.x, dy = pb.y - pa.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 80) * 0.002;
        pa.vx += dx * f; pa.vy += dy * f; pb.vx -= dx * f; pb.vy -= dy * f;
      }
      for (const n of nodes) { const p = pos.get(n.id); p.vx += (W / 2 - p.x) * 0.0005; p.vy += (Hh / 2 - p.y) * 0.0005; p.x += p.vx *= 0.85; p.y += p.vy *= 0.85; p.x = Math.max(12, Math.min(W - 12, p.x)); p.y = Math.max(12, Math.min(Hh - 12, p.y)); }
    }
    function draw() {
      ctx.clearRect(0, 0, W, Hh);
      ctx.strokeStyle = '#E8B6CB'; ctx.lineWidth = 1;
      for (const e of edges) { const pa = pos.get(e.from), pb = pos.get(e.to); if (!pa || !pb) continue; ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); }
      ctx.font = '10px ui-monospace, monospace';
      for (const n of nodes) { const p = pos.get(n.id); ctx.fillStyle = n.color || '#D6336C'; ctx.beginPath(); ctx.arc(p.x, p.y, n.r || 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#4E2A3C'; ctx.fillText((n.label || n.id).slice(0, 28), p.x + 7, p.y + 3); }
    }
    let iter = 0; const anim = () => { for (let i = 0; i < 4; i++) step(); draw(); if (iter++ < 120) requestAnimationFrame(anim); }; anim();
    void idx; void opts;
    return canvas;
  }


  // ---------- the session graph: shared renderers ----------
  function labelTag(l) {
    const kind = l.split(':')[0];
    const cls = { delegated_swarm_fetch: 'bad', cross_session_handoff: 'rose', handoff_origin: 'lilac', crawler_precursor: 'lilac', cohort_match: 'lilac', ua_spoof_suspected: 'warn', prompt_echo: 'rose', hop_chain: 'rose', swarm_member: 'bad', cluster_member: '', canary_cross_session: 'rose' }[kind];
    const m = l.match(/^(cross_session_handoff|handoff_origin):(SW-[0-9A-F]{8})$/);
    if (m) return link('#/handoffs?edge=' + m[2], tag(l.replace(/_/g, ' '), cls || ''));
    const sw = l.match(/^(swarm_member|cluster_member):(.+)$/);
    if (sw) return link('#/cluster/' + sw[2], tag(l.replace(/_/g, ' '), cls || ''));
    return tag(l.replace(/_/g, ' '), cls || '');
  }
  function describeLabel(l) {
    const [kind, ...rest] = l.split(':'); const arg = rest.join(':');
    switch (kind) {
      case 'delegated_swarm_fetch': return 'a request or two, no cookie, nothing rendered, under 50ms, landing cold on something deep: and the graph links it to another session. a delegated fetch, not an unknown';
      case 'cross_session_handoff': return ['presented a per-session token minted for another session (edge ', link('#/handoffs?edge=' + arg, arg), '): it was handed the url'];
      case 'handoff_origin': return ['a token minted for this session was presented by another one (edge ', link('#/handoffs?edge=' + arg, arg), '): this session is upstream of a hand-off'];
      case 'crawler_precursor': return `a declared crawler (${arg.split('@')[0]}) read the same page ${arg.split('@')[1] || ''} earlier from another address`;
      case 'cohort_match': return `the url's cv= watermark matched the arm vector of an upstream session (${arg.split(':').pop()} of the distribution)`;
      case 'ua_spoof_suspected': return `a browser user-agent (${arg.replace('_no_subresources', '')}) on a stateless fetch with no sec-fetch headers and no sub-resources: the string is not what fetched the page`;
      case 'prompt_echo': return `called the ${arg.replace('_', '.').replace(':incomplete', '')} tool${arg.endsWith(':incomplete') ? ' without every required field' : ' with caller role and upstream context'}`;
      case 'hop_chain': return `carried a breadcrumb key as far as ${arg.replace(/_/g, ' ')}`;
      case 'swarm_member': return ['member of distributed pool ', link('#/cluster/' + arg, arg)];
      case 'cluster_member': return ['member of behavioural cohort ', link('#/cluster/' + arg, arg)];
      case 'canary_cross_session': return `${arg} canary sighting(s) of ids only another session was shown`;
      default: return l;
    }
  }
  function graphBadges(gs) {
    if (!gs) return '';
    const out = (gs.labels || []).map(labelTag);
    if (!out.length && gs.delegated) out.push(tag('delegated shape, unlinked', ''));
    return out;
  }
  function edgeKindTag(e) { return e.kind === 'token' ? tag('token · hop ' + (e.hop === null ? '—' : e.hop), 'rose') : e.kind === 'cohort' ? tag('cohort ' + pct(e.confidence), 'lilac') : tag('precursor ' + pct(e.confidence), 'lilac'); }
  function edgeTable(edges, opts) {
    if (!edges || !edges.length) return h('p', { class: 'muted' }, (opts && opts.empty) || 'none in range');
    return table([
      { label: 'when', render: (r) => fmtTs(r.ts) },
      { label: 'edge', render: (r) => h('code', { class: 'small', id: 'edge-' + r.id }, r.id) },
      { label: 'kind', render: (r) => edgeKindTag(r) },
      { label: 'origin', render: (r) => [sid(r.from_session), ' ', tag(r.from_family || 'none'), ' ', classTag(r.from_class)] },
      { label: '', render: () => '→' },
      { label: 'target', render: (r) => [sid(r.to_session), ' ', tag(r.to_family || 'none'), ' ', classTag(r.to_class)] },
      { label: 'planted in', render: (r) => r.page_id ? [pageLink(r.page_id), r.section ? h('span', { class: 'muted small' }, ' · ' + r.section.replace(/_/g, ' ')) : null] : '—' },
      { label: 'presented in', render: (r) => r.seen_in ? h('code', { class: 'small' }, r.seen_in) : '—' },
      { label: 'token', render: (r) => r.token ? h('code', { class: 'small' }, r.token) : '' },
      { label: 'Δt', render: (r) => r.delta_ms !== null && r.delta_ms !== undefined ? fmtRel(r.delta_ms) : '—' },
      { label: 'asked for', render: (r) => h('code', { class: 'small' }, (r.target_path || '').slice(0, 48)) },
    ], edges);
  }
  function chainCard(c) {
    const hops = c.hops.map((hp) => h('div', { class: 'hop' },
      h('span', { class: 'hopno' }, 'hop ' + hp.hop),
      h('span', null, sid(hp.from_session), ' ', tag(hp.from_family || 'none'), ' ', h('span', { class: 'muted small' }, hp.from_role), ' ', classTag(hp.from_class)),
      h('span', { class: 'arrow' }, '→'),
      h('span', null, sid(hp.to_session), ' ', tag(hp.to_family || 'none'), ' ', h('span', { class: 'muted small' }, hp.to_role), ' ', classTag(hp.to_class)),
      h('span', { class: 'muted small' }, hp.page_id ? [pageLink(hp.page_id), ' · ', (hp.section || '').replace(/_/g, ' ')] : ''),
      h('span', { class: 'lag' }, hp.gap_ms !== null ? '+' + fmtRel(hp.gap_ms) + ' after previous hop' : hp.lag_ms !== null ? fmtRel(hp.lag_ms) + ' after minting' : '')));
    return h('div', { class: 'chain' + (c.complete ? ' complete' : '') }, h('div', { class: 'chainhead' }, c.complete ? tag('complete · reached verify', 'bad') : tag(`partial · ${c.hops.length} hop${c.hops.length === 1 ? '' : 's'}`, 'rose'), ' ', h('span', { class: 'muted small' }, c.roles), ' ', h('span', { class: 'muted small' }, `· ${fmtTs(c.first)} → ${fmtTs(c.last)} · ${fmtRel(c.total_ms)} end to end`)), ...hops);
  }
  function scratchTable(rows, opts) {
    if (!rows || !rows.length) return h('p', { class: 'muted' }, (opts && opts.empty) || 'no captures in range');
    return h('div', null, rows.map((r) => h('div', { class: 'scratch' + (r.complete ? '' : ' incomplete') },
      h('div', { class: 'scratchhead' }, h('span', { class: 'muted' }, fmtTs(r.ts)), ' ', tag(r.endpoint.replace(/_/g, '.'), 'rose'), ' ', tag(r.method), ' ', h('span', { class: `st s${String(r.status)[0]}` }, r.status), ' ', r.complete ? tag('complete', 'ok') : tag('missing fields', 'warn'), ' ', opts && opts.noSession ? null : [sid(r.session_id), ' ', tag(r.ua_family || 'none'), ' ', classTag(r.likely_class)], r.origin_session_id ? [' ', tag('key from ' + (r.origin_family || 'another session'), 'lilac'), ' ', sid(r.origin_session_id)] : null, r.token_issued ? h('span', { class: 'muted small' }, ' · issued ' + r.token_issued) : null),
      kv({ query: r.query_text || '—', 'caller role': r.caller_role || '—', 'upstream context': r.upstream_context || '—', 'verification token': r.verification_token || '—' }),
      h('details', null, h('summary', { class: 'hint' }, 'everything it sent'), h('pre', null, JSON.stringify({ params: r.params, body: r.body_text, headers: r.headers }, null, 2))))));
  }

  // ---------- views ----------
  const views = {};
  views.overview = async (root) => {
    const d = await api(`/api/overview?${qs()}`);
    const t = d.totals;
    root.append(
      h('h1', null, 'overview'),
      h('div', { class: 'stats' },
        stat(t.requests, 'requests'), stat(t.sessions, 'sessions'), stat(t.errors, 'error responses'), stat(t.sightings, 'canary sightings'), stat(t.cross_session_sightings, 'cross-session sightings'), stat(t.sessions_reaching_hidden, 'sessions reaching hidden pages')),
      h('div', { class: 'grid', style: 'margin-top:14px' },
        h('section', { class: 'card span8' }, h('h3', null, `requests per ${fmtRel(d.bucket_ms)} bucket · dashed = errors`), sparkline(d.series)),
      ),
    );
    const g = root.lastChild;
    g.appendChild(withSpan(card('likely class (heuristic)', hbars(d.classes.map((c) => ({ label: c.class.replace(/_/g, ' '), value: c.n })), {}), h('p', { class: 'hint' }, 'evidence-backed labels, not identities')), 'span4'));
    g.appendChild(withSpan(card('declared user-agent family (self-reported)', hbars(d.families.map((f) => ({ label: f.family, value: f.n })), { cls: 'lilac' })), 'span4'));
    g.appendChild(withSpan(card('resource kinds requested', hbars(d.kinds.map((k) => ({ label: k.kind, value: k.n })), {})), 'span4'));
    g.appendChild(withSpan(card('how pages were first reached', hbars(d.discovery.map((x) => ({ label: x.via.replace('channel:', 'via '), value: x.n })), { cls: 'lilac' }), h('p', { class: 'hint' }, 'referer = followed a link; channel = fetched the machine list that names the page; sequence = inferred from order; unknown = hidden page with no observed path')), 'span4'));
    g.appendChild(withSpan(card('most reached pages', table([{ label: 'page', render: (r) => pageLink(r.page) }, { label: 'class', render: (r) => tag(r.discover || '') }, { label: 'sessions', key: 'sessions', num: true }, { label: 'requests', key: 'requests', num: true }], d.top_pages)), 'span8'));
    g.appendChild(withSpan(card('recent canary sightings', d.recent_sightings.length ? table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'canary', render: (r) => h('code', null, r.canary_id.replace('QUANTARA-SWARMGLASS-', '…')) }, { label: 'seen in', key: 'seen_in' }, { label: 'session', render: (r) => r.session_id ? sid(r.session_id) : tag('external', 'lilac') }, { label: 'flags', render: (r) => [r.cross_session ? tag('cross-session', 'rose') : null, r.cross_actor ? tag('cross-actor', 'bad') : null] }], d.recent_sightings) : h('p', { class: 'muted' }, 'none in range')), 'span4'));
    g.appendChild(withSpan(card('active experiments', d.experiments.length ? table([{ label: 'id', render: (r) => link('#/experiment/' + r.id, r.id) }, { label: 'name', key: 'name' }, { label: 'variable', key: 'variable' }, { label: 'arms', key: 'arms', num: true }], d.experiments) : h('p', { class: 'muted' }, 'none active')), 'span6'));
    g.appendChild(withSpan(card('storage', d.disk ? kv({ state: d.disk.degraded ? `DEGRADED (${d.disk.reason})` : 'ok', 'db size': `${(d.disk.dbBytes / 1048576).toFixed(1)} MB of ${(d.disk.limitBytes / 1048576).toFixed(0)} MB` }) : h('p', { class: 'muted' }, 'disk guard has not run yet')), 'span6'));
    g.appendChild(withSpan(card('activity by hour (utc) × weekday, requests in range', activityHeat(d.activity)), 'span12'));
    const hist = await api(`/api/history?days=30&synthetic=${encodeURIComponent(state.synthetic)}`);
    g.appendChild(withSpan(card('the last 30 days, from the daily rollups (these outlive the retention window; the traffic filter applies, the range does not)', historyTable(hist.days)), 'span12'));
  };
  function stat(v, k) { return h('div', { class: 'card stat' }, h('span', { class: 'v' }, num(v)), h('span', { class: 'k' }, k)); }
  function withSpan(el, cls) { el.classList.add(cls); return el; }
  function activityHeat(a) {
    if (!a || !a.total) return h('p', { class: 'muted' }, 'no requests in range');
    const t = heatTable(a.rows, a.cols, a.cells, { corner: 'day \\ hour' });
    t.querySelector('table').classList.add('compact');
    return [t, h('p', { class: 'hint' }, `${a.total.toLocaleString()} requests · busiest cell ${a.peak.toLocaleString()} · a pool that keeps office hours somewhere shows up as a band`)];
  }
  function historyTable(days) {
    if (!days || !days.length) return h('p', { class: 'muted' }, 'no rollups yet — the rollup job runs every ten minutes');
    const max = Math.max(1, ...days.map((x) => x.requests));
    return table([
      { label: 'day', key: 'day' },
      { label: 'requests', render: (r) => [h('span', { class: 'inlinebar' }, bar(r.requests, max)), num(r.requests)] },
      { label: 'sessions', key: 'sessions', num: true },
      { label: 'errors', key: 'errors', num: true },
      { label: 'sightings', key: 'canary_sightings', num: true },
      { label: 'likely classes', render: (r) => Object.entries(r.by_class).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => tag(`${k.replace(/_/g, ' ')} ${v}`)) },
      { label: 'kinds', render: (r) => Object.entries(r.by_kind).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => tag(`${k} ${v}`, 'lilac')) },
    ], [...days].reverse());
  }
  function deadTable(rows) {
    return (rows || []).length ? table([{ label: 'path', render: (r) => h('code', null, r.path) }, { label: 'requests', key: 'n', num: true }, { label: 'sessions', key: 's', num: true }], rows) : h('p', { class: 'muted' }, 'none in range');
  }

  views.live = async (root) => {
    const hint = state.synthetic === 'real' ? 'real traffic only, per the filter above' : state.synthetic === 'synthetic' ? 'synthetic traffic only, per the filter above' : 'all traffic; synthetic rows are dimmed';
    root.append(h('h1', null, 'live'), h('p', { class: 'hint' }, `last 200 events, polled every 2s. ${hint}.`));
    const list = h('div');
    root.appendChild(list);
    let since = 0;
    const seen = new Set();
    // the live endpoints don't take the traffic filter, so honour it here
    const wanted = (e) => state.synthetic === 'all' || Boolean(e.synthetic) === (state.synthetic === 'synthetic');
    async function tick() {
      if (!document.body.contains(list)) return;
      try {
        const d = await api(`/api/live/${since ? 'poll?since=' + since : 'tail'}`);
        for (const e of d.events) {
          const key = e.ts + e.session_id + e.path + (e.query || '');
          since = Math.max(since, e.ts);
          if (seen.has(key)) continue;
          seen.add(key);
          if (!wanted(e)) continue;
          // every cell gets its own span. two bare strings side by side collapse into one grid cell and
          // everything after them slides a column left. the path was landing underneath the session link
          list.prepend(h('div', { class: 'live-row' + (e.is_new_session ? ' new' : '') + (e.synthetic ? ' synthetic' : ''), 'data-key': key },
            h('span', { class: 'muted' }, fmtTs(e.ts).slice(11)),
            h('span', null, e.method),
            h('span', { class: `st s${String(e.status)[0]}` }, e.status),
            h('span', { class: 'mono' }, e.path, e.query ? h('span', { class: 'q' }, '?' + e.query) : null),
            h('span', null, sid(e.session_id), ' ', e.is_new_session ? tag('new', 'rose') : ''),
            h('span', null, tag(e.ua_family), e.canaries_seen ? tag(`${e.canaries_seen} canary`, 'lilac') : '', e.handoffs ? tag(`${e.handoffs} hand-off`, 'bad') : '', e.agent_query ? tag('prompt-echo', 'rose') : '')));
          while (list.children.length > 200) list.lastChild.remove();
        }
        // the poll only returns things newer than `since`, so the set only has to cover what's on screen.
        // left alone it grows by one string per event for as long as the tab stays open
        if (seen.size > 1000) { seen.clear(); for (const row of list.children) seen.add(row.dataset.key); }
      } catch (err) { /* keep polling */ }
      setTimeout(tick, 2000);
    }
    // first poll on a timer, not inline: the view is built in a detached fragment and only lands in the document
    // after this function resolves, so an inline tick() sees "not in body" and quietly never polls
    setTimeout(tick, 0);
  };

  views.sessions = async (root, params) => {
    const f = Object.assign({ class: '', family: '', q: '', sort: 'recent', min_requests: '', offset: 0, cluster: '', experiment: '', arm: '', signature: '' }, params || {});
    root.append(h('h1', null, 'sessions'));
    const form = h('div', { class: 'filters' },
      h('label', null, 'class ', sel('class', ['', 'human_browser', 'search_bot', 'naive_crawler', 'aggressive_crawler', 'scripted_agent', 'retrieval_agent', 'tool_discovery_agent', 'unknown'], f.class)),
      h('label', null, 'sort ', sel('sort', ['recent', 'requests', 'pages', 'confidence', 'hidden'], f.sort)),
      h('label', null, 'min requests ', h('input', { type: 'text', name: 'min_requests', value: f.min_requests, size: 3 })),
      h('label', null, 'search ', h('input', { type: 'search', name: 'q', value: f.q, placeholder: 'id, ua, path' })),
      f.cluster ? tag('cluster ' + f.cluster, 'lilac') : null, f.experiment ? tag(`${f.experiment}${f.arm ? ':' + f.arm : ''}`, 'lilac') : null, f.signature ? link('#/signatures', tag('signature ' + f.signature, 'lilac')) : null,
      h('button', { onclick: () => { const p = {}; for (const el of form.querySelectorAll('select,input')) if (el.value) p[el.name] = el.value; if (f.cluster) p.cluster = f.cluster; if (f.experiment) p.experiment = f.experiment; if (f.arm) p.arm = f.arm; if (f.signature) p.signature = f.signature; location.hash = '#/sessions?' + new URLSearchParams(p).toString(); } }, 'apply'));
    root.appendChild(form);
    const q = new URLSearchParams(Object.assign({}, f, { limit: 100 }));
    const d = await api(`/api/sessions?${qs()}&${q.toString()}`);
    root.append(h('p', { class: 'hint' }, `${d.total.toLocaleString()} sessions in range`));
    root.appendChild(table([
      { label: 'started', render: (r) => fmtTs(r.started_at) },
      { label: 'session', render: (r) => sid(r.id) },
      { label: 'class', render: (r) => [classTag(r.likely_class), r.class_confidence !== null ? h('span', { class: 'muted small' }, ` ${Number(r.class_confidence).toFixed(2)}`) : null] },
      { label: 'ua family', render: (r) => tag(r.ua_family || 'none') },
      { label: 'req', key: 'n_requests', num: true }, { label: 'pages', key: 'n_unique_pages', num: true }, { label: 'depth', key: 'max_depth', num: true }, { label: 'machine', key: 'n_machine', num: true }, { label: 'disallowed', key: 'n_disallowed', num: true }, { label: 'err', key: 'n_errors', num: true },
      { label: 'cookie', render: (r) => r.cookie_returned ? tag('yes', 'ok') : tag('no') },
      { label: 'dur', render: (r) => fmtRel(r.last_seen_at - r.started_at) },
      { label: 'first path', render: (r) => h('code', null, (r.first_path || '').slice(0, 40)) },
      { label: 'cohorts', render: (r) => r.cohorts ? Object.entries(r.cohorts).map(([k, v]) => tag(`${k.replace('SGX-', '')}:${v}`, 'lilac')) : '' },
      { label: 'flags', render: (r) => [r.synthetic ? tag('synthetic ' + (r.synthetic_persona || ''), 'warn') : null, r.cluster_id ? link('#/cluster/' + r.cluster_id, r.cluster_id) : null] },
      { label: 'swarm evidence', render: (r) => graphBadges(r.graph) },
    ], d.rows, { link: (r) => '#/session/' + encodeURIComponent(r.id) }));
    root.appendChild(h('div', { class: 'pagination' }, f.offset > 0 ? h('button', { class: 'ghost', onclick: () => go({ offset: Math.max(0, Number(f.offset) - 100) }) }, '← newer') : null, `offset ${f.offset}`, d.total > Number(f.offset) + 100 ? h('button', { class: 'ghost', onclick: () => go({ offset: Number(f.offset) + 100 }) }, 'older →') : null));
    function go(extra) { location.hash = '#/sessions?' + new URLSearchParams(Object.assign({}, f, extra)).toString(); }
  };
  function sel(name, options, value) { const s = h('select', { name }); for (const o of options) s.appendChild(h('option', { value: o, selected: o === value ? '' : null }, o || 'any')); return s; }

  views.session = async (root, params, id) => {
    const d = await api(`/api/sessions/${encodeURIComponent(id)}`);
    if (d.error) { root.append(h('p', { class: 'error' }, d.error)); return; }
    const s = d.session, st = d.story;
    root.append(h('h1', null, 'session ', h('code', null, s.id)),
      h('p', null, classTag(s.likely_class), ' ', tag(`ua: ${s.ua_family || 'none'}`), ' ', s.synthetic ? tag(`synthetic · ${s.synthetic_persona || ''}`, 'warn') : null, ' ', s.cluster_id ? (s.cluster_id.startsWith('SW-') ? tag('member of swarm ' + s.cluster_id, 'bad') : null) : null, ' ', s.cluster_id ? link('#/cluster/' + s.cluster_id, (s.cluster_id.startsWith('SW-') ? 'open swarm ' : 'cluster ') + s.cluster_id) : null, ' ', s.cohorts ? Object.entries(s.cohorts).map(([k, v]) => link('#/experiment/' + k, `${k}:${v} `)) : null),
      h('div', { class: 'story' }, st.summary),
      h('ul', { class: 'caveats' }, st.caveats.map((c) => h('li', null, c))));
    const grid = h('div', { class: 'grid' });
    root.appendChild(grid);
    grid.appendChild(withSpan(card('facts', kv({ started: fmtTs(s.started_at), 'last seen': fmtTs(s.last_seen_at), duration: fmtRel(s.last_seen_at - s.started_at), kind: s.kind, 'network prefix': s.ip_trunc || '(not stored)', 'user-agent': s.ua || '(none)', 'cookie returned': s.cookie_returned ? 'yes' : 'no', requests: s.n_requests, 'unique pages': s.n_unique_pages, 'max depth': s.max_depth, 'machine fetches': s.n_machine, 'disallowed fetches': s.n_disallowed, errors: s.n_errors, 'first referer host': s.first_referer_host || '—', actor: s.actor_hash, 'other sessions of actor': d.actor_sessions.length }), h('p', { class: 'hint' }, link('#/actor/' + encodeURIComponent(s.actor_hash), 'every session of this actor, and what it carried between them →'))), 'span4'));
    if (s.scores) {
      const traits = Object.entries(s.scores.traits).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v.value }));
      grid.appendChild(withSpan(card('traits (heuristic, 0–1)', hbars(traits, { fmt: (v) => v.toFixed(2) })), 'span4'));
      const cls = Object.entries(s.scores.classes).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v }));
      grid.appendChild(withSpan(card('class probabilities (softmax over rule sums)', hbars(cls, { fmt: pct, cls: 'lilac' }), h('details', null, h('summary', { class: 'hint' }, 'why: rules that fired'), h('ul', { class: 'evidence' }, Object.entries(s.scores.class_evidence).flatMap(([c, ev]) => ev.map((e) => h('li', null, h('span', { class: 'w' }, (e.weight > 0 ? '+' : '') + e.weight), ` ${c}: ${e.note}`)))))), 'span4'));
      grid.appendChild(withSpan(card('trait evidence', h('ul', { class: 'evidence' }, Object.entries(s.scores.traits).flatMap(([t, v]) => v.evidence.map((e) => h('li', null, h('span', { class: 'w' }, (e.weight > 0 ? '+' : '') + e.weight), ` ${t}: ${e.note}`))))), 'span6'));
    } else grid.appendChild(withSpan(card('scores', h('p', { class: 'muted' }, 'not scored yet — sessions are scored ~30s after their last request')), 'span4'));
    grid.appendChild(withSpan(card('request gaps', hbars(d.gap_histogram.map((b) => ({ label: b.label, value: b.n })), {})), 'span6'));
    if (d.pages.length) {
      const nodes = d.pages.map((p) => ({ id: p.id, label: p.id, color: p.discover === 'visible' ? '#F06595' : '#8B6FE8', r: 5 }));
      const edges = d.edges.map((e) => ({ from: e.from_page, to: e.to_page }));
      grid.appendChild(withSpan(card('navigation graph (pink = visible page, purple = hidden; edges = referer or inferred sequence)', forceGraph(nodes, edges)), 'span12'));
    }
    grid.appendChild(withSpan(card('pages reached, in order', table([{ label: '#', key: 'order_no', num: true }, { label: 'page', render: (r) => pageLink(r.page_id) }, { label: 'class', render: (r) => tag(r.discover_class || 'visible', r.discover_class && r.discover_class !== 'visible' ? 'rose' : '') }, { label: 'depth', key: 'depth', num: true }, { label: 'via', render: (r) => h('code', null, r.via) }, { label: 't+', render: (r) => fmtRel(r.ts - s.started_at) }], d.discoveries)), 'span6'));
    grid.appendChild(withSpan(card('canaries', h('p', { class: 'hint' }, `${d.exposures.length} exposed · ${d.sightings.length} presented`), d.sightings.length ? table([{ label: 't+', render: (r) => fmtRel(r.ts - s.started_at) }, { label: 'canary', render: (r) => h('code', null, r.canary_id) }, { label: 'in', key: 'seen_in' }, { label: 'flags', render: (r) => [r.cross_session ? tag('cross-session', 'rose') : tag('own exposure', 'ok'), r.cross_actor ? tag('cross-actor', 'bad') : null] }, { label: 'delta', render: (r) => r.delta_ms !== null ? fmtRel(r.delta_ms) : '—' }], d.sightings) : null, h('details', null, h('summary', { class: 'hint' }, 'exposed canaries'), table([{ label: 'canary', render: (r) => h('code', null, r.canary_id) }, { label: 'placement', key: 'placement' }, { label: 't+', render: (r) => fmtRel(r.first_at - s.started_at) }], d.exposures))), 'span6'));
    // the session graph: what other sessions' requests say about this one
    const gr = d.graph || null;
    grid.appendChild(withSpan(card('graph & canary evidence (cross-session signals, each one stated)',
      gr && gr.labels && gr.labels.length ? h('div', null, h('p', null, gr.labels.map(labelTag)), h('ul', { class: 'evidence' }, gr.labels.map((l) => h('li', null, describeLabel(l))))) : h('p', { class: 'muted' }, gr ? 'no cross-session signal: nothing handed this session a url, nothing it was given came back, no lookup tool was called' : 'not scored yet'),
      gr && gr.shape ? h('p', { class: 'hint' }, `shape: ${gr.shape.delegated ? 'stateless delegated fetch (≤2 requests, no cookie, nothing rendered, <50ms, cold deep landing)' : gr.shape.cold_deep ? 'cold deep landing, but more than a delegated fetch' : 'not a cold deep landing'}${gr.shape.ua_spoof ? ' · browser string without browser headers' : ''}`) : null,
      h('p', { class: 'hint' }, 'heuristics are research labels with stated evidence, never identity claims. a label here says what was observed across sessions; it does not say who sent any of it.')), 'span6'));
    const ho = d.handoffs || { edges_in: [], edges_out: [] };
    grid.appendChild(withSpan(card(`hand-offs: ${ho.edges_in.length} in · ${ho.edges_out.length} out (directed edges this session is part of)`,
      ho.edges_in.length ? [h('h3', null, 'handed to this session'), edgeTable(ho.edges_in)] : null,
      ho.edges_out.length ? [h('h3', null, 'handed out by this session'), edgeTable(ho.edges_out)] : null,
      !ho.edges_in.length && !ho.edges_out.length ? h('p', { class: 'muted' }, 'no directed edge touches this session') : null), 'span6'));
    if ((d.agent_queries || []).length) grid.appendChild(withSpan(card('prompt-echo captures: what this session told the lookup tools', scratchTable(d.agent_queries, { noSession: true })), 'span12'));
    if ((d.tokens_minted || []).length) grid.appendChild(withSpan(card('per-session tokens minted for this session (a later presenter was handed the url by this session)', table([{ label: 'token', render: (r) => h('code', null, r.token) }, { label: 'planted in', render: (r) => [r.page_id ? pageLink(r.page_id) : '—', ' ', h('span', { class: 'muted small' }, (r.section || '').replace(/_/g, ' '))] }, { label: 'hop', key: 'hop', num: true }, { label: 'cv', render: (r) => h('code', { class: 'small' }, r.cohort_slug || '') }, { label: 't+', render: (r) => fmtRel(r.issued_at - s.started_at) }, { label: 'renders', key: 'issue_count', num: true }, { label: 'presented by others', render: (r) => r.presented_by_others ? tag(String(r.presented_by_others), 'bad') : '0' }], d.tokens_minted)), 'span12'));
    if (d.similar.length) grid.appendChild(withSpan(card('similar sessions (page-set jaccard ≥ 0.3, ±7 days)', table([{ label: 'session', render: (r) => sid(r.id) }, { label: 'jaccard', key: 'jaccard', num: true }, { label: 'same actor', render: (r) => r.same_actor ? tag('yes', 'lilac') : '' }, { label: 'class', render: (r) => classTag(r.likely_class) }, { label: 'ua', render: (r) => tag(r.ua_family || '') }, { label: 'started', render: (r) => fmtTs(r.started_at) }], d.similar)), 'span6'));
    if (d.actor_sessions.length) grid.appendChild(withSpan(card('other sessions from the same actor fingerprint', table([{ label: 'session', render: (r) => sid(r.id) }, { label: 'started', render: (r) => fmtTs(r.started_at) }, { label: 'req', key: 'n_requests', num: true }, { label: 'class', render: (r) => classTag(r.likely_class) }], d.actor_sessions)), 'span6'));
    // story timeline
    const tl = h('div', { class: 'timeline' });
    for (const step of st.steps) {
      tl.appendChild(h('div', { class: 'step ' + step.flags.join(' ') }, h('span', { class: 'n' }, step.n), h('span', { class: 't' }, fmtRel(step.rel_ms)), h('span', { class: 'gap' }, step.gap_ms === null ? '' : '+' + fmtRel(step.gap_ms)), h('span', { class: `st s${String(step.status)[0]}` }, step.status), h('div', null, h('span', { class: 'path' }, `${step.method} ${step.path}`, step.query ? h('span', { class: 'q' }, '?' + step.query) : null), ' ', step.kind !== 'page' ? tag(step.kind) : null, step.negotiated && step.negotiated !== 'html' ? tag(step.negotiated, 'lilac') : null, step.discover && step.discover !== 'visible' ? tag(step.discover, 'rose') : null, step.notes.length ? h('ul', { class: 'notes' }, step.notes.map((n) => h('li', null, n))) : null)));
    }
    grid.appendChild(withSpan(card('story view — every request, with what it tells us', tl), 'span12'));
    grid.appendChild(withSpan(card('raw features', h('pre', null, JSON.stringify(s.features, null, 2))), 'span12'));
  };

  views.clusters = async (root) => {
    const d = await api(`/api/clusters?${qs()}`);
    root.append(h('h1', null, 'cohorts'), note('sessions are grouped by page-set overlap, feature similarity, client signature, network prefix, and time overlap. the swarm score sums the coordination signals listed for each group; a high score is a reason to look, not a conclusion. distributed swarms are found separately over the last 7 days: one exact user-agent across many network prefixes, one or two requests each, nothing rendered.'));
    if (!d.clusters.length) { root.append(h('p', { class: 'muted' }, 'no groups in range — clustering runs every 5 minutes over the last 24h of scored sessions')); return; }
    for (const c of d.clusters) {
      if (c.kind === 'swarm') {
        const s = c.summary || {};
        root.appendChild(card(`${c.id} · swarm · ${s.sessions} sessions across ${s.prefixes} prefixes · ${fmtTs(c.window_start)} → ${fmtTs(c.window_end)}${c.synthetic ? ' · SYNTHETIC' : ''}`,
          h('p', null, tag(c.label, 'bad'), ' ', s.by === 'stack' ? tag(`${s.ua_strings} user-agent strings on one stack`, 'rose') : null, s.tier === 'loose' ? tag('a few requests per address') : null, (c.signals || []).some((x) => x.signal === 'shared_frontier') ? tag('one queue, many addresses', 'bad') : null, (c.signals || []).some((x) => x.signal === 'metronomic_pool') ? tag('on a beat', 'lilac') : null, ' ', tag('ua: ' + (s.ua_family || 'none')), ' ', h('code', { class: 'muted' }, s.ua_sample || '')),
          h('div', { class: 'two' },
            h('div', null, h('h3', null, 'signals'), h('ul', { class: 'evidence' }, c.signals.map((x) => h('li', null, h('span', { class: 'w' }, x.strength.toFixed(2)), ` ${x.signal.replace(/_/g, ' ')}: ${x.note}`)))),
            h('div', null, h('h3', null, 'shape'), swarmShape(s))),
          h('p', null, link('#/cluster/' + c.id, 'open swarm →'), ' · ', link('#/sessions?cluster=' + c.id, 'filter sessions'))));
        continue;
      }
      root.appendChild(card(`${c.id} · ${c.label} · swarm score ${c.swarm_score.toFixed(2)} · ${c.size} sessions · ${fmtTs(c.window_start)} → ${fmtTs(c.window_end)}${c.synthetic ? ' · SYNTHETIC' : ''}`,
        h('div', { class: 'two' },
          h('div', null, h('h3', null, 'signals'), c.signals.length ? h('ul', { class: 'evidence' }, c.signals.map((s) => h('li', null, h('span', { class: 'w' }, s.strength.toFixed(2)), ` ${s.signal.replace(/_/g, ' ')}: ${s.note}`))) : h('p', { class: 'muted' }, 'similar sessions, no coordination signal')),
          h('div', null, h('h3', null, 'members'), table([{ label: 'session', render: (r) => sid(r.id) }, { label: 'ua', render: (r) => tag(r.ua_family || '') }, { label: 'class', render: (r) => classTag(r.likely_class) }, { label: 'net', render: (r) => h('code', null, r.ip_trunc || '—') }, { label: 'pages', key: 'n_unique_pages', num: true }, { label: 'started', render: (r) => fmtTs(r.started_at) }], c.members))),
        h('p', null, link('#/cluster/' + c.id, 'open cohort →'), ' · ', link('#/sessions?cluster=' + c.id, 'filter sessions'))));
    }
  };
  function swarmShape(s) {
    return kv({ 'grouped by': s.by === 'stack' ? `one http stack behind ${s.ua_strings} user-agent strings (${(s.families || []).join(', ')})` : 'one exact user-agent string', tier: s.tier === 'loose' ? 'a few requests per address' : 'one or two requests per address', sessions: s.sessions, requests: s.requests, 'requests per session (median)': s.requests_per_session_median === undefined ? '—' : s.requests_per_session_median, 'network prefixes': `${s.prefixes} (${s.prefixes16} wider blocks)`, 'one-or-two-request sessions': pct(s.single_hit_share), 'asset share': pct(s.asset_share), 'conditional requests (If-None-Match etc.)': pct(s.conditional_share), 'pages touched': s.pages, 'a new address every': s.median_start_gap_ms ? fmtRel(s.median_start_gap_ms) : '—', cadence: s.cadence_ms ? `${fmtRel(s.cadence_ms)} ± 25% holds ${pct(s.cadence_share)} of the time` : '—', 'client stack': s.stack || '—', 'first seen': s.first_seen ? fmtTs(s.first_seen) : '—', 'last seen': s.last_seen ? fmtTs(s.last_seen) : '—' });
  }
  function fmtCounts(o) { return o && Object.keys(o).length ? Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ') : '—'; }
  function poolProfileCards(d) {
    const out = [];
    const pr = (d.summary || {}).profile;
    if (pr) {
      out.push(card('what the pool sends (every member request)', h('div', { class: 'two' },
        h('div', null, kv({ requests: pr.requests, methods: fmtCounts(pr.methods), 'http versions': fmtCounts(pr.http_versions), 'tls, as the proxy saw it': fmtCounts(pr.tls), 'accept profiles': fmtCounts(pr.accept_profiles), 'accept-encoding': fmtCounts(pr.accept_encodings), 'accept-language': fmtCounts(pr.accept_languages) })),
        h('div', null, kv({ 'cookie returned': pct(pr.shares.cookie), 'pragma on the request': pct(pr.shares.pragma), 'conditional (If-*)': pct(pr.shares.conditional), 'accept-language present': pct(pr.shares.accept_language), 'internal referer': pct(pr.shares.referer_internal), 'external referer': pct(pr.shares.referer_external), 'HEAD requests': pct(pr.shares.head) }), h('h3', null, 'http stacks (header order minus cookie, referer and the proxy)'), h('ul', { class: 'evidence' }, (pr.stacks || []).map((s) => h('li', null, h('span', { class: 'w' }, String(s.requests)), ' ', h('code', null, s.stack || 'none'), ' ', h('span', { class: 'muted small' }, (s.names || []).join(' → ')))))))));
      out.push(card('what the pool takes', h('div', { class: 'two' },
        h('div', null, kv({ 'resource kinds': fmtCounts(pr.kinds), 'status classes': fmtCounts(pr.statuses), representations: fmtCounts(pr.negotiated), 'query keys used': fmtCounts(pr.query_keys) })),
        h('div', null, kv({ 'canaries shown to members': pr.canaries.exposed, 'canaries presented back': pr.canaries.presented, 'presented by an actor never shown them': pr.canaries.cross_actor })))));
    }
    const ho = (d.summary || {}).handoffs;
    if (ho) out.push(card('urls passed between members (a member reaches a page it was never shown, right after another member was shown a page linking there)', [
      kv({ 'reaches needing a source': ho.considered, 'explained by the member\'s own history': ho.explained, 'handed over by another member': ho.handoffs, 'no visible source (an index, a cache, prior knowledge)': ho.unsourced, 'share handed over': pct(ho.share), 'median lag': ho.median_lag_ms !== null && ho.median_lag_ms !== undefined ? fmtRel(ho.median_lag_ms) : '—' }),
      (ho.sample || []).length ? table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'shown to', render: (r) => sid(r.from_session) }, { label: 'fetched by', render: (r) => sid(r.to_session) }, { label: 'page', render: (r) => pageLink(r.page) }, { label: 'linked from', render: (r) => pageLink(r.parent) }, { label: 'lag', render: (r) => fmtRel(r.lag_ms) }], ho.sample) : null,
      (ho.top_pages || []).length ? h('p', { class: 'hint' }, 'most handed over: ', ho.top_pages.map((p) => [pageLink(p.page), ` (${p.n}) `])) : null,
    ]));
    if (d.pool && d.pool.length) out.push(card('the pool over time: addresses per day, and how many it had never used before', table([{ label: 'day', key: 'day' }, { label: 'sessions', key: 'sessions', num: true }, { label: 'prefixes', key: 'prefixes', num: true }, { label: 'new', key: 'new_prefixes', num: true }, { label: 'returning', key: 'returning_prefixes', num: true }], d.pool)));
    if (d.related && d.related.length) out.push(card('related pools (addresses in common, or the same http stack underneath: possibly one operator)', table([{ label: 'pool', render: (r) => link('#/cluster/' + r.id, r.id) }, { label: 'label', key: 'label' }, { label: 'sessions', key: 'size', num: true }, { label: 'ua', render: (r) => tag(r.ua_family || '') }, { label: 'shared prefixes', key: 'shared_prefixes', num: true }, { label: 'same stack', render: (r) => r.same_stack ? tag('yes', 'bad') : '' }, { label: 'window', render: (r) => `${fmtTs(r.window_start)} → ${fmtTs(r.window_end)}` }], d.related)));
    return out;
  }
  views.cluster = async (root, params, id) => {
    const d = await api(`/api/clusters/${encodeURIComponent(id)}`);
    if (d.error) { root.append(h('p', { class: 'error' }, d.error)); return; }
    const swarm = d.kind === 'swarm';
    root.append(h('h1', null, swarm ? 'swarm ' : 'cohort ', h('code', null, d.id)), h('p', null, tag(d.label, swarm ? 'bad' : 'lilac'), ` swarm score ${d.swarm_score.toFixed(2)} · ${d.size} sessions`));
    root.appendChild(card('signals', h('ul', { class: 'evidence' }, d.signals.map((s) => h('li', null, h('span', { class: 'w' }, s.strength.toFixed(2)), ` ${s.signal.replace(/_/g, ' ')}: ${s.note}`)))));
    root.appendChild(card('activity by hour (utc) × weekday, every request by a member', activityHeat(d.activity)));
    const members = d.members.map((m) => m.id);
    const pages = Object.keys(d.page_matrix).sort();
    if (swarm) {
      // a 96-column matrix says nothing; for a swarm the question is which pages the pool was handed
      root.appendChild(card('shape', swarmShape(d.summary || {})));
      for (const c of poolProfileCards(d)) root.appendChild(c);
      root.appendChild(card('pages touched, and by how many members', table([{ label: 'page', render: (r) => pageLink(r.page) }, { label: 'members', key: 'n', num: true }], pages.map((p) => ({ page: p, n: d.page_matrix[p].length })).sort((a, b) => b.n - a.n))));
      const m = d.metrics || {};
      if (m.saturation && m.saturation.length) root.appendChild(card('frontier saturation: new pages per hour (a corpus builder runs out of new pages, then comes back or leaves)', table([{ label: 'hour (utc)', render: (r) => fmtTs(r.hour).slice(0, 13) + ':00' }, { label: 'requests', key: 'requests', num: true }, { label: 'new pages', key: 'fresh', num: true }, { label: 'new share', render: (r) => pct(r.requests ? r.fresh / r.requests : 0) }], m.saturation)));
      if (m.revisits && m.revisits.length) root.appendChild(card('revisits: pages the pool fetched more than once', table([{ label: 'page', render: (r) => pageLink(r.page) }, { label: 'fetches', key: 'fetches', num: true }, { label: 'median gap', render: (r) => fmtRel(r.median_gap_ms) }, { label: 'last', render: (r) => fmtTs(r.last_ts) }], m.revisits)));
      if (m.frontier) root.appendChild(card('frontier lag: first fetch of a page after the pool last fetched a page that links to it', m.frontier.n ? [kv({ 'pages with a measurable lag': m.frontier.n, p25: fmtRel(m.frontier.p25_ms), median: fmtRel(m.frontier.median_ms), p75: fmtRel(m.frontier.p75_ms) }), table([{ label: 'page', render: (r) => pageLink(r.page) }, { label: 'after', render: (r) => pageLink(r.parent) }, { label: 'lag', render: (r) => fmtRel(r.lag_ms) }], m.frontier.samples)] : h('p', { class: 'muted' }, 'no page-to-page handoff observed yet: every first fetch came before, or without, a fetch of a page that links to it')));
    } else {
      const cells = {}; for (const p of pages) { cells[p] = {}; for (const m of d.page_matrix[p]) cells[p][m.slice(0, 8)] = 1; }
      root.appendChild(card('page coverage matrix (which member fetched which page)', heatTable(pages, members.map((m) => m.slice(0, 8)), cells, { corner: 'page \\ session' })));
    }
    root.appendChild(card('members', table([{ label: 'session', render: (r) => sid(r.id) }, { label: 'actor', render: (r) => h('code', null, r.actor_hash.slice(0, 10)) }, { label: 'ua', render: (r) => tag(r.ua_family || '') }, { label: 'class', render: (r) => [classTag(r.likely_class), ' ', h('span', { class: 'muted' }, num(r.class_confidence))] }, { label: 'net', render: (r) => h('code', null, r.ip_trunc || '—') }, { label: 'req', key: 'n_requests', num: true }, { label: 'pages', key: 'n_unique_pages', num: true }, { label: 'started', render: (r) => fmtTs(r.started_at) }, { label: 'ended', render: (r) => fmtTs(r.last_seen_at) }], d.members)));
  };

  views.pages = async (root) => {
    const [d, m] = await Promise.all([api(`/api/pages?${qs()}`), api(`/api/discovery?${qs()}`)]);
    root.append(h('h1', null, 'pages & discovery'));
    root.appendChild(card('discoverability class reached × likely class (sessions)', m.classes.length ? heatTable(m.classes, m.discover_classes, m.cells, { corner: 'class \\ hiding place' }) : h('p', { class: 'muted' }, 'no discoveries in range'), h('p', { class: 'hint' }, 'visible = linked from normal navigation. *_only = named only in that machine channel. orphan = nothing points at it. experiment = exposure controlled by an active experiment arm.')));
    const rows = d.pages;
    root.appendChild(card('funnel — every page and attachment, by sessions that reached it', table([
      { label: 'page', render: (r) => pageLink(r.id) }, { label: 'kind', render: (r) => tag(r.kind) }, { label: 'discover', render: (r) => tag(r.discover, r.discover !== 'visible' ? 'rose' : '') }, { label: 'depth', key: 'depth', num: true }, { label: 'sessions', key: 'sessions', num: true }, { label: 'requests', key: 'requests', num: true }, { label: 'mean t+', render: (r) => r.mean_first_ms ? fmtRel(r.mean_first_ms) : '—' },
      { label: 'via', render: (r) => Object.entries(r.via).map(([k, v]) => tag(`${k.replace('channel:', '')} ${v}`, k.startsWith('channel') ? 'lilac' : '')) },
      { label: 'by class', render: (r) => Object.entries(r.by_class).map(([k, v]) => tag(`${k.replace(/_/g, ' ')} ${v}`)) },
      { label: 'exp', render: (r) => r.experiment ? link('#/experiment/' + r.experiment, r.experiment) : '' },
    ], rows)));
  };
  views.page = async (root, params, id) => {
    const [d, t] = await Promise.all([api(`/api/pages?${qs()}`), api(`/api/pages/${encodeURIComponent(id)}/timing?${qs()}`)]);
    const p = d.pages.find((x) => x.id === id);
    root.append(h('h1', null, 'page ', h('code', null, id)));
    if (!p) { root.append(h('p', { class: 'muted' }, 'not in catalog')); return; }
    root.appendChild(card('catalog', kv({ title: p.title, kind: p.kind, discover: p.discover, depth: p.depth, channels: p.channels.join(', ') || '—', experiment: p.experiment || '—', 'sessions reaching': p.sessions, requests: p.requests, 'median time to reach': t.n ? fmtRel(t.median_ms) : '—', 'p90': t.n ? fmtRel(t.p90_ms) : '—' })));
    root.appendChild(card('how it was reached', hbars(Object.entries(p.via).map(([k, v]) => ({ label: k, value: v })), { cls: 'lilac' })));
    root.appendChild(card('sessions that reached it', table([{ label: 'session', render: (r) => sid(r.session_id) }, { label: 'class', render: (r) => classTag(r.cls) }, { label: 'via', render: (r) => h('code', null, r.via) }, { label: 't+', render: (r) => fmtRel(r.dt) }], t.rows)));
  };

  views.canaries = async (root) => {
    const d = await api(`/api/canaries?${qs()}`);
    root.append(h('h1', null, 'canaries'), note('a canary is an inert identifier planted in a specific place (visible text, html comment, meta tag, json-ld, header, feed, api, attachment). when one comes back in a later request we learn what was read and — for per-session canaries — whether it crossed sessions.'));
    const g = h('div', { class: 'grid' }); root.appendChild(g);
    g.appendChild(withSpan(card('issued by placement / scope', table([{ label: 'scope', key: 'scope' }, { label: 'placement', key: 'placement' }, { label: 'issued', key: 'issued', num: true }, { label: 'sessions exposed (range)', key: 'exposed_sessions', num: true }], d.placements)), 'span6'));
    g.appendChild(withSpan(card('sightings by placement of origin', table([{ label: 'scope', key: 'scope' }, { label: 'placement', key: 'placement' }, { label: 'sightings', key: 'n', num: true }, { label: 'cross-session', key: 'xs', num: true }, { label: 'cross-actor', key: 'xa', num: true }], d.sightings_by_placement)), 'span6'));
    g.appendChild(withSpan(card('where canaries came back', hbars(d.sightings_by_where.map((w) => ({ label: w.w, value: w.n })), {})), 'span4'));
    const nodes = [], edges = [], seen = new Set();
    for (const e of d.propagation_edges) {
      if (!seen.has(e.canary_id)) { seen.add(e.canary_id); nodes.push({ id: e.canary_id, label: e.canary_id.replace('QUANTARA-SWARMGLASS-', ''), color: '#D6336C', r: 6 }); }
      if (e.exposure_session_id && !seen.has(e.exposure_session_id)) { seen.add(e.exposure_session_id); nodes.push({ id: e.exposure_session_id, label: e.exposure_session_id.slice(0, 8), color: '#F06595' }); }
      if (e.session_id && !seen.has(e.session_id)) { seen.add(e.session_id); nodes.push({ id: e.session_id, label: e.session_id.slice(0, 8), color: e.external ? '#2E0F1E' : '#8B6FE8' }); }
      if (e.exposure_session_id) edges.push({ from: e.exposure_session_id, to: e.canary_id });
      if (e.session_id) edges.push({ from: e.canary_id, to: e.session_id });
    }
    const tk = d.tokens || {};
    g.appendChild(withSpan(card('per-session tokens (scope S, placement token: a checksum, build id or reference minted for one session)', kv({ 'minted in range': tk.minted, 'sessions given one': tk.minted_sessions, 'presented by another session': tk.presented_cross_session, 'of which another actor': tk.presented_cross_actor, 'sessions that presented one': tk.presenting_sessions }), (tk.by_hop || []).length ? table([{ label: 'hop', key: 'hop', num: true }, { label: 'edges', key: 'n', num: true }, { label: 'mean lag', render: (r) => r.mean_lag_ms ? fmtRel(r.mean_lag_ms) : '—' }], tk.by_hop) : null, (tk.transitions || []).length ? h('p', null, 'ua transitions: ', tk.transitions.map((t) => tag(`${t.t} ×${t.n}`, 'rose'))) : null, (tk.by_section || []).length ? h('details', null, h('summary', { class: 'hint' }, 'minted by section'), table([{ label: 'section', render: (r) => r.section.replace(/_/g, ' ') }, { label: 'hop', key: 'hop', num: true }, { label: 'minted', key: 'n', num: true }], tk.by_section)) : null), 'span4'));
    g.appendChild(withSpan(card('directed edges from token sightings (origin session → presenting session)', edgeTable(d.directed, { empty: 'no per-session token has come back from another session in range' })), 'span12'));
    g.appendChild(withSpan(card('propagation graph (rose = canary, pink = exposed session, purple = presenting session, ink = external)', nodes.length ? forceGraph(nodes, edges) : h('p', { class: 'muted' }, 'no cross-session or external sightings in range')), 'span8'));
    g.appendChild(withSpan(card('recent sightings', table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'canary', render: (r) => h('code', null, r.canary_id) }, { label: 'origin', render: (r) => [tag(r.scope || '?'), tag(r.placement || '?'), r.page_id ? pageLink(r.page_id) : null] }, { label: 'seen in', key: 'seen_in' }, { label: 'session', render: (r) => r.session_id ? sid(r.session_id) : tag('external', 'lilac') }, { label: 'exposed to', render: (r) => r.exposure_session_id ? sid(r.exposure_session_id) : '—' }, { label: 'delta', render: (r) => r.delta_ms !== null ? fmtRel(r.delta_ms) : '—' }, { label: 'flags', render: (r) => [r.cross_session ? tag('cross-session', 'rose') : null, r.cross_actor ? tag('cross-actor', 'bad') : null, r.external ? tag('external', 'lilac') : null] }, { label: 'context', render: (r) => h('code', null, (r.detail || '').slice(0, 60)) }], d.recent)), 'span12'));
    const form = h('div', { class: 'filters' }, h('input', { type: 'text', name: 'canary_id', placeholder: 'QUANTARA-SWARMGLASS-R7-4F91C2', size: 34 }), h('input', { type: 'text', name: 'source', placeholder: 'source (search engine, forum, model output…)', size: 30 }), h('input', { type: 'text', name: 'url', placeholder: 'url (optional)', size: 30 }), h('input', { type: 'text', name: 'note', placeholder: 'note', size: 30 }), h('button', { onclick: async () => { const body = {}; for (const el of form.querySelectorAll('input')) body[el.name] = el.value; const r = await api('/api/canaries/external', { method: 'POST', body: JSON.stringify(body) }); msg.textContent = r.ok ? 'recorded' : 'error: ' + r.error; if (r.ok) setTimeout(() => route(), 800); } }, 'record external sighting'));
    const msg = h('span', { class: 'hint' });
    g.appendChild(withSpan(card('record an external sighting (a canary seen in a search index, a forum, a model answer…)', form, msg), 'span12'));
  };

  views.experiments = async (root) => {
    const d = await api('/api/experiments');
    root.append(h('h1', null, 'experiments'), h('p', { class: 'hint' }, `seed ${d.seed_version} · definitions in config/experiments/ · one variable per target at a time`));
    if (d.errors.length) root.appendChild(card('definition problems', h('ul', { class: 'error' }, d.errors.map((e) => h('li', null, e)))));
    root.appendChild(card('registry', table([{ label: 'id', render: (r) => link('#/experiment/' + r.id, r.id) }, { label: 'name', key: 'name' }, { label: 'status', render: (r) => tag(r.status, r.status === 'active' ? 'ok' : '') }, { label: 'variable', render: (r) => h('code', null, r.variable) }, { label: 'scope', key: 'scope' }, { label: 'targets', render: (r) => r.targets.map((t) => pageLink(t)) }, { label: 'arms', render: (r) => r.arms.map((a) => tag(`${a.id}=${a.value}`)) }, { label: 'unit', render: (r) => r.assignment.unit }, { label: 'v', key: 'version', num: true }], d.experiments)));
    root.appendChild(card('activation history (what ran when, against which seed and heuristics)', table([{ label: 'experiment', key: 'experiment_id' }, { label: 'v', key: 'version', num: true }, { label: 'activated', render: (r) => fmtTs(r.activated_at) }, { label: 'seed', key: 'seed_version' }, { label: 'heuristics', key: 'heuristics_version', num: true }], d.runs)));
  };
  views.experiment = async (root, params, id) => {
    const d = await api(`/api/experiments/${encodeURIComponent(id)}?${qs()}`);
    if (d.error) { root.append(h('p', { class: 'error' }, d.error)); return; }
    const e = d.experiment;
    root.append(h('h1', null, `${e.id} · ${e.name}`), h('p', null, tag(e.status, e.status === 'active' ? 'ok' : ''), ' ', h('code', null, e.variable), ' · ', e.scope, e.targets.length ? [' · targets: ', e.targets.map((t) => pageLink(t))] : null), h('div', { class: 'story' }, e.hypothesis));
    const outcomeIds = e.outcomes.map((o) => o.id);
    root.appendChild(card('arms compared', table([
      { label: 'arm', render: (r) => tag(r.arm, 'lilac') }, { label: 'label', key: 'label' }, { label: 'value', render: (r) => h('code', null, r.value) }, { label: 'sessions', render: (r) => link(`#/sessions?experiment=${e.id}&arm=${r.arm}`, String(r.sessions)) }, { label: 'actors', key: 'actors', num: true },
      ...outcomeIds.map((o) => ({ label: o, render: (r) => fmtOutcome(r.outcomes[o]) })),
      { label: 'class mix', render: (r) => Object.entries(r.classes).map(([k, v]) => tag(`${k.replace(/_/g, ' ')} ${v}`)) },
    ], d.arms)), h('ul', { class: 'caveats' }, d.notes.map((n) => h('li', null, n))));
    const reach = e.outcomes.find((o) => o.metric === 'page_reached');
    if (reach) root.appendChild(card(`reach rate — ${reach.page || reach.id}`, hbars(d.arms.map((a) => ({ label: `${a.arm}: ${a.label}`, value: (a.outcomes[reach.id] && a.outcomes[reach.id].rate) || 0 })), { fmt: pct })));
    if (d.tokens) root.appendChild(card('carrier urls — the revision id each arm hands out; a fetch is credited to the arm whose id it carries, whoever fetches it', kv(Object.fromEntries(Object.entries(d.tokens).map(([arm, tok]) => [`arm ${arm}`, `?oldid=${tok}`]))), d.unattributed && d.unattributed.sessions ? h('p', { class: 'hint' }, `${d.unattributed.sessions} session(s) / ${d.unattributed.actors} actor(s) fetched the target with no carrier id`) : null));
    root.appendChild(card('download', h('p', null, h('a', { href: `/api/experiments/${e.id}/bundle?${qs()}&level=public`, download: '' }, 'public bundle (sanitized json)'), ' · ', h('a', { href: `/api/experiments/${e.id}/bundle?${qs()}&level=internal`, download: '' }, 'internal bundle (keeps truncated prefixes + ua strings; never publish)')), h('p', { class: 'hint' }, 'bundles carry the definition, the comparison table, sanitized session rows, an event sample, seed + heuristics versions, and a sha256 of the payload.')));
    if (e.fiction_map) root.appendChild(card('fiction map — which public element is which stimulus', kv(e.fiction_map)));
    root.appendChild(card('definition', h('pre', null, JSON.stringify(e, null, 2))));
  };
  function fmtOutcome(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      if ('exposed' in v) return `${v.reached}/${v.exposed} exposed (${pct(v.rate)}${v.wilson95 ? ` CI ${pct(v.wilson95[0])}–${pct(v.wilson95[1])}` : ''}) · ${v.cross_actor} cross-actor`;
      if ('rate' in v) return `${v.reached ?? v.sessions ?? 0} (${pct(v.rate)}${v.wilson95 ? ` CI ${pct(v.wilson95[0])}–${pct(v.wilson95[1])}` : ''})`;
      if ('median_s' in v) return v.median_s === null ? 'n/a' : `med ${v.median_s}s · p90 ${v.p90_s}s · n=${v.n}`;
      if ('mean' in v) return `mean ${v.mean ?? '—'} · max ${v.max ?? '—'}`;
      return Object.entries(v).map(([k, x]) => `${k} ${x}`).join(', ');
    }
    return String(v);
  }

  views.motifs = async (root, params) => {
    const n = (params && params.n) || 3;
    const d = await api(`/api/motifs?${qs()}&n=${n}`);
    root.append(h('h1', null, 'repeated motifs'), h('div', { class: 'filters' }, 'n-gram length ', sel('n', ['2', '3', '4', '5'], String(n)), h('button', { onclick: (ev) => { location.hash = '#/motifs?n=' + ev.target.parentNode.querySelector('select').value; } }, 'apply')), note('request sequences that appear in more than one session. shared motifs across different actors are a soft coordination hint — or just the shape of the site.'));
    root.appendChild(card('motifs', table([{ label: 'sequence', render: (r) => h('code', null, r.motif) }, { label: 'sessions', key: 'sessions', num: true }, { label: 'sample', render: (r) => r.sample.map((s) => [sid(s), ' ']) }], d.motifs)));
    const hc = d.hop_chains || { chains: [], motifs: [], complete: 0 };
    root.appendChild(card(`breadcrumb chains across sessions: ${hc.chains.length} in range · ${hc.complete} complete`, note('a motif that crosses sessions: hop 1 (lore page → machine export), hop 2 (export → activity feed), hop 3 (feed → verify endpoint), each hop taken by a different session. the role sequence is by declared ua category; the lag is between hops.'), hc.motifs.length ? table([{ label: 'role sequence', render: (r) => h('code', null, r.sequence) }, { label: 'families (sample)', render: (r) => h('span', { class: 'small' }, r.families) }, { label: 'chains', key: 'chains', num: true }, { label: 'complete', key: 'complete', num: true }, { label: 'median end to end', render: (r) => r.median_total_ms !== null ? fmtRel(r.median_total_ms) : '—' }], hc.motifs) : h('p', { class: 'muted' }, 'no chain in range'), hc.chains.slice(0, 12).map(chainCard), hc.chains.length ? h('p', { class: 'hint' }, link('#/handoffs', 'every chain and edge, on the hand-offs page →')) : null));
  };

  views.anomalies = async (root) => {
    const d = await api(`/api/anomalies?${qs()}`);
    root.append(h('h1', null, 'anomalies'));
    const g = h('div', { class: 'grid' }); root.appendChild(g);
    g.appendChild(withSpan(card('distributed swarms (one client signature, many addresses, one hit each)', (d.swarms || []).length ? table([{ label: 'swarm', render: (r) => link('#/cluster/' + r.id, r.id) }, { label: 'grouped by', render: (r) => (r.summary || {}).by === 'stack' ? tag(`stack · ${(r.summary || {}).ua_strings} strings`, 'rose') : tag('ua string') }, { label: 'ua', render: (r) => tag((r.summary || {}).ua_family || '') }, { label: 'sessions', render: (r) => num((r.summary || {}).sessions) }, { label: 'prefixes', render: (r) => num((r.summary || {}).prefixes) }, { label: 'one-hit share', render: (r) => pct((r.summary || {}).single_hit_share) }, { label: 'pages', render: (r) => num((r.summary || {}).pages) }, { label: 'first seen', render: (r) => fmtTs(r.window_start) }, { label: 'last seen', render: (r) => fmtTs(r.window_end) }], d.swarms) : h('p', { class: 'muted' }, 'none in range: no user-agent hash with 12+ sessions across 8+ prefixes, mostly one-hit, nothing rendered')), 'span12'));
    g.appendChild(withSpan(card('malformed / unusual requests', table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'session', render: (r) => sid(r.session_id) }, { label: 'method', key: 'method' }, { label: 'path', render: (r) => h('code', null, r.path.slice(0, 70)) }, { label: 'status', key: 'status', num: true }, { label: 'flags', render: (r) => JSON.parse(r.malformed).map((f) => tag(f, 'warn')) }], d.malformed)), 'span12'));
    g.appendChild(withSpan(card('rate limited sessions', table([{ label: 'session', render: (r) => sid(r.session_id) }, { label: '429s', key: 'n', num: true }, { label: 'ua', render: (r) => tag(r.ua_family || '') }], d.rate_limited)), 'span4'));
    g.appendChild(withSpan(card('heavy sessions (≥200 requests)', table([{ label: 'session', render: (r) => sid(r.session_id) }, { label: 'requests', key: 'n', num: true }, { label: 'ua', render: (r) => tag(r.ua_family || '') }], d.heavy_sessions)), 'span4'));
    g.appendChild(withSpan(card('non-GET methods', table([{ label: 'method', key: 'method' }, { label: 'n', key: 'n', num: true }], d.methods)), 'span4'));
    g.appendChild(withSpan(card('write attempts', table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'session', render: (r) => sid(r.session_id) }, { label: 'path', render: (r) => h('code', null, r.path) }, { label: 'status', key: 'status', num: true }, { label: 'body', render: (r) => `${r.body_bytes} B ${r.body_ctype || ''}` }], d.posts)), 'span6'));
    g.appendChild(withSpan(card('scanner sessions (three or more misses from the secrets-and-panels alphabet: .env, .git, wp-*, phpmyadmin, backup dumps…)', (d.scanners || []).length ? table([{ label: 'started', render: (r) => fmtTs(r.started_at) }, { label: 'session', render: (r) => sid(r.session_id) }, { label: 'ua', render: (r) => tag(r.ua_family || '') }, { label: 'requests', key: 'requests', num: true }, { label: 'misses', key: 'missing', num: true }, { label: 'scanner paths', key: 'scanner_hits', num: true }, { label: 'sample', render: (r) => r.sample.map((p) => [h('code', null, p), ' ']) }], d.scanners, { link: (r) => '#/session/' + encodeURIComponent(r.session_id) }) : h('p', { class: 'muted' }, 'none in range')), 'span12'));
    g.appendChild(withSpan(card('scanner paths asked for', deadTable(d.scanner_paths)), 'span4'));
    g.appendChild(withSpan(card('other missing paths (nothing on the site points at these)', deadTable(d.dead_paths)), 'span4'));
    g.appendChild(withSpan(card('red links followed (/wiki/ pages that do not exist; every page links a Discussion tab, most have no talk page)', deadTable(d.red_links)), 'span4'));
    g.appendChild(withSpan(card('probe-like requests (injection patterns and scanner paths, flagged on the way in)', table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'session', render: (r) => sid(r.session_id) }, { label: 'path', render: (r) => h('code', null, r.path.slice(0, 80)) }, { label: 'status', key: 'status', num: true }], d.probes)), 'span6'));
    g.appendChild(withSpan(card('search queries typed into the wiki', table([{ label: 'query', render: (r) => h('code', null, r.q || '') }, { label: 'n', key: 'n', num: true }], d.searches)), 'span6'));
  };

  views.signatures = async (root) => {
    const d = await api(`/api/signatures?${qs()}`);
    root.append(h('h1', null, 'client signatures'), note('a signature is the order a client sends its request headers in. a user-agent is a string anyone can set; the header order is set by the http stack and rarely touched. one order behind several user-agent strings is one client wearing masks, which is the thing the swarm detector cannot see, since it groups by the mask. signatures shared by two or more sessions, most sessions first.'));
    if (!d.signatures.length) { root.append(h('p', { class: 'muted' }, 'no signature shared by two sessions in range')); return; }
    root.appendChild(card('signatures', table([
      { label: 'signature', render: (r) => h('code', null, r.signature) },
      { label: 'reads as', render: (r) => [r.masks ? tag(`${r.ua_strings} user-agent strings`, 'bad') : null, r.spread ? tag('many prefixes, one hit each', 'rose') : null, !r.masks && !r.spread ? tag('one client string') : null] },
      { label: 'sessions', render: (r) => link('#/sessions?signature=' + encodeURIComponent(r.signature), String(r.sessions)) },
      { label: 'actors', key: 'actors', num: true }, { label: 'requests', key: 'requests', num: true }, { label: 'prefixes', key: 'prefixes', num: true }, { label: 'pages', key: 'pages', num: true },
      { label: 'families', render: (r) => r.families.map((f) => tag(f)) },
      { label: 'http', render: (r) => (r.http_versions || []).map((v) => tag('http/' + v, 'lilac')) },
      { label: 'tls, as the proxy saw it', render: (r) => (r.tls || []).length ? (r.tls || []).map((t) => h('code', { class: 'small' }, t + ' ')) : h('span', { class: 'muted' }, '—') },
      { label: 'accept-encoding', render: (r) => (r.accept_encodings || []).map((e) => h('code', { class: 'small' }, e + ' ')) },
      { label: 'first', render: (r) => fmtTs(r.first_seen) }, { label: 'last', render: (r) => fmtTs(r.last_seen) },
      { label: 'headers, in wire order', render: (r) => h('code', { class: 'small' }, r.header_names.join(' → ')) },
      { label: 'user-agent strings (sessions)', render: (r) => h('ul', { class: 'evidence' }, r.ua_samples.map((u) => h('li', null, h('span', { class: 'w' }, String(u.sessions)), ' ', h('code', null, u.ua || '(none)')))) },
    ], d.signatures)));
  };

  views.actor = async (root, params, hash) => {
    const d = await api(`/api/actors/${encodeURIComponent(hash)}`);
    if (d.error) { root.append(h('p', { class: 'error' }, d.error)); return; }
    const s = d.summary;
    root.append(h('h1', null, 'actor ', h('code', null, d.actor_hash)), note('one actor fingerprint (network prefix + user-agent string), every session it had. the question this page asks is memory: did a later session go straight to pages only an earlier one was shown, and did it present a canary it was shown last time? the fingerprint is coarse on purpose; one corporate nat is one actor.'));
    const g = h('div', { class: 'grid' }); root.appendChild(g);
    g.appendChild(withSpan(card('summary', kv({ sessions: s.sessions, 'first seen': fmtTs(s.first_seen), 'last seen': fmtTs(s.last_seen), requests: s.requests, 'distinct pages': s.distinct_pages, 'pages seen in more than one session': s.pages_seen_in_more_than_one_session, 'canaries shown': s.canaries_exposed, 'canaries carried across sessions': s.canaries_carried_across_sessions, 'user-agent strings': s.ua_strings, 'network prefixes': s.prefixes, classes: Object.entries(s.classes).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') })), 'span4'));
    g.appendChild(withSpan(card('sessions, in order', table([{ label: 'started', render: (r) => fmtTs(r.started_at) }, { label: 'session', render: (r) => sid(r.id) }, { label: 'class', render: (r) => classTag(r.likely_class) }, { label: 'req', key: 'n_requests', num: true }, { label: 'pages', key: 'n_unique_pages', num: true }, { label: 'machine', key: 'n_machine', num: true }, { label: 'cookie', render: (r) => r.cookie_returned ? tag('yes', 'ok') : tag('no') }, { label: 'canaries shown', render: (r) => num(d.exposed_by_session[r.id] || 0) }, { label: 'dur', render: (r) => fmtRel(r.last_seen_at - r.started_at) }, { label: 'flags', render: (r) => [r.synthetic ? tag('synthetic', 'warn') : null, r.cluster_id ? link('#/cluster/' + r.cluster_id, r.cluster_id) : null] }], d.sessions, { link: (r) => '#/session/' + encodeURIComponent(r.id) })), 'span8'));
    const sessionIds = d.sessions.map((x) => x.id);
    const pages = Object.keys(d.page_matrix).sort((a, b) => d.first_reached[a].ts - d.first_reached[b].ts);
    if (pages.length) {
      const cells = {}; for (const p of pages) { cells[p] = {}; for (const id of d.page_matrix[p]) cells[p][id.slice(0, 8)] = 1; }
      g.appendChild(withSpan(card('pages × sessions, rows in the order the actor first reached them (a page lit in a later column is one it came back for)', heatTable(pages, sessionIds.map((id) => id.slice(0, 8)), cells, { corner: 'page \\ session' })), 'span12'));
    }
    g.appendChild(withSpan(card('canaries presented', d.sightings.length ? table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'session', render: (r) => sid(r.session_id) }, { label: 'canary', render: (r) => h('code', null, r.canary_id) }, { label: 'in', key: 'seen_in' }, { label: 'shown where', render: (r) => r.carried_from ? [tag('carried across sessions', 'bad'), ' from ', sid(r.carried_from), ' ', tag(r.carried_placement, 'lilac'), ' ', h('span', { class: 'muted' }, fmtRel(r.carried_after_ms) + ' earlier')] : (r.cross_session ? tag('never shown to this actor: another actor, a cache, or an index', 'rose') : tag('same session', 'ok')) }], d.sightings) : h('p', { class: 'muted' }, 'this actor never presented a canary')), 'span12'));
  };

  views.handoffs = async (root, params) => {
    const d = await api(`/api/handoffs?${qs()}`);
    root.append(h('h1', null, 'hand-offs'), note('where did a visitor get a url it was never shown? a reach is explained when the actor itself, in any session, had already been served a page that links there or the channel that lists it. an unexplained reach whose linking page was served to a different actor shortly before is a hand-off between the two: one queue, many addresses. the entry page, everything one link from it and everything a machine channel lists are left out, anybody can know those.'));
    const g = h('div', { class: 'grid' }); root.appendChild(g);
    g.appendChild(withSpan(card('in range', kv({ 'reaches needing a source': d.considered, 'explained by the actor\'s own history': d.explained, 'handed over by another actor': d.handoffs, 'no visible source (an index, a cache, prior knowledge)': d.unsourced, 'share handed over': pct(d.share), 'median lag': d.median_lag_ms !== null ? fmtRel(d.median_lag_ms) : '—' })), 'span4'));
    g.appendChild(withSpan(card('most handed-over pages', d.top_pages.length ? hbars(d.top_pages.map((p) => ({ label: p.page, value: p.n })), {}) : h('p', { class: 'muted' }, 'none')), 'span8'));
    g.appendChild(withSpan(card('groups of actors that pass urls around (connected by hand-offs)', d.components.length ? table([
      { label: 'actors', key: 'actor_count', num: true }, { label: 'hand-offs', key: 'edges', num: true }, { label: 'pages', key: 'pages', num: true }, { label: 'prefixes', key: 'prefixes', num: true },
      { label: 'families', render: (r) => r.families.map((f) => tag(f)) },
      { label: 'pools', render: (r) => r.swarms.map((s) => link('#/cluster/' + s, s)) },
      { label: 'median lag', render: (r) => r.median_lag_ms !== null ? fmtRel(r.median_lag_ms) : '—' },
      { label: 'first → last', render: (r) => r.first ? `${fmtTs(r.first)} → ${fmtTs(r.last)}` : '—' },
      { label: 'members', render: (r) => r.actors.slice(0, 12).map((a) => [link('#/actor/' + encodeURIComponent(a.actor), a.actor.slice(0, 8)), h('span', { class: 'muted small' }, ` ${a.ua_family || 'none'} `)]) },
    ], d.components) : h('p', { class: 'muted' }, 'no hand-offs in range')), 'span12'));
    g.appendChild(withSpan(card('recent hand-offs (inferred from the link graph)', d.sample.length ? table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'shown to', render: (r) => [sid(r.from_session), ' ', tag(r.from_family || 'none')] }, { label: 'fetched by', render: (r) => [sid(r.to_session), ' ', tag(r.to_family || 'none')] }, { label: 'page', render: (r) => pageLink(r.page) }, { label: 'linked from', render: (r) => pageLink(r.parent) }, { label: 'lag', render: (r) => fmtRel(r.lag_ms) }], d.sample) : h('p', { class: 'muted' }, 'none')), 'span12'));
    // the recorded graph: per-session tokens that came back from another session are certain edges; cohort and
    // precursor edges are a distribution over who could have handed the url over
    const et = d.edge_totals || {};
    const wanted = params && params.edge ? params.edge : null;
    const edges = wanted ? (d.edges || []).filter((e) => e.id === wanted).concat((d.edges || []).filter((e) => e.id !== wanted)) : (d.edges || []);
    g.appendChild(withSpan(card(`directed canary edges: ${et.token || 0} token (certain) · ${et.cohort || 0} cohort · ${et.precursor || 0} precursor`, wanted ? h('p', { class: 'hint' }, 'edge ', h('code', null, wanted), ' first', (d.edges || []).some((e) => e.id === wanted) ? '' : ' (not in range)') : null, note('a token edge: session B presented a per-session token that was minted for session A on a specific page section. the ua transition on the edge (bingbot → safari) is the pipeline changing hands. a cohort edge: B landed cold on a url carrying the cv= arm-vector watermark served to A. a precursor edge: no watermark, but a declared crawler read the same page from another address shortly before.'), edgeTable(edges)), 'span12'));
    g.appendChild(withSpan(card(`multi-hop breadcrumb chains: ${(d.chains || []).length} in range · ${d.chains_complete || 0} reached the verify endpoint`, note("hop 1: a visible lore page points at a machine export under a per-session reference. hop 2: the export carries structured records and a verification key pointing at an operator's activity feed. hop 3: the feed points at /api/v1/registry/verify, which needs caller_role and upstream_context. each hop handled by a different session is a role split in the pipeline that fetched it."), (d.chains || []).length ? d.chains.map(chainCard) : h('p', { class: 'muted' }, 'no chain in range')), 'span12'));
    if ((d.chain_motifs || []).length) g.appendChild(withSpan(card('chain motifs: who handled which hop, by declared role', table([{ label: 'role sequence', render: (r) => h('code', null, r.sequence) }, { label: 'families (sample)', render: (r) => h('span', { class: 'small' }, r.families) }, { label: 'chains', key: 'chains', num: true }, { label: 'complete', key: 'complete', num: true }, { label: 'median end to end', render: (r) => r.median_total_ms !== null ? fmtRel(r.median_total_ms) : '—' }], d.chain_motifs)), 'span12'));
  };

  views.llm = async (root) => {
    const d = await api(`/api/llm?${qs()}`);
    root.append(h('h1', null, 'llm traffic'), note('every self-declared model crawler and on-demand fetcher in range: what it reads, whether it comes as a pool, whether urls move between it and anyone else, and what the proxy saw of its handshake. the family is a claim in a string; everything else is behaviour.'));
    if (!d.families.length) root.append(h('p', { class: 'muted' }, 'no self-declared ai crawler or fetcher in range'));
    else root.appendChild(card('families', table([
      { label: 'family', render: (r) => [tag(r.family, r.category === 'ai_fetcher' ? 'lilac' : 'rose'), h('span', { class: 'muted small' }, ' ' + r.category.replace('_', ' '))] },
      { label: 'sessions', render: (r) => link(`#/sessions?family=${encodeURIComponent(r.family)}`, String(r.sessions)) }, { label: 'actors', key: 'actors', num: true }, { label: 'prefixes', key: 'prefixes', num: true }, { label: 'requests', key: 'requests', num: true },
      { label: 'one-hit', render: (r) => pct(r.one_hit_share) }, { label: 'pages', key: 'pages', num: true }, { label: 'hidden', key: 'hidden_reaches', num: true },
      { label: 'alternates', render: (r) => pct(r.alt_share) }, { label: 'llms.txt', key: 'llms_txt', num: true }, { label: 'manifests', key: 'manifests', num: true }, { label: 'robots', key: 'robots', num: true }, { label: 'disallowed', key: 'disallowed', num: true },
      { label: 'cookie', render: (r) => pct(r.cookie_share) }, { label: 'h2', render: (r) => pct(r.h2_share) }, { label: 'conditional', render: (r) => pct(r.conditional_share) },
      { label: 'stacks', render: (r) => r.stacks.map((s) => h('code', { class: 'small' }, (s.stack || 'none') + ' ')) },
      { label: 'tls', render: (r) => r.tls.length ? r.tls.map((t) => h('code', { class: 'small' }, t.tls + ' ')) : h('span', { class: 'muted' }, '—') },
      { label: 'classes', render: (r) => Object.entries(r.classes).map(([k, v]) => tag(`${k.replace(/_/g, ' ')} ${v}`)) },
      { label: 'pools', render: (r) => r.pools.map((p) => link('#/cluster/' + p, p)) },
      { label: 'hand-offs', render: (r) => r.handoffs.out || r.handoffs.in ? [tag(`out ${r.handoffs.out}`), tag(`in ${r.handoffs.in}`), ...r.handoffs.partners.map((p) => tag('with ' + p, 'lilac'))] : '' },
      { label: 'canaries', render: (r) => r.canaries.presented ? `${r.canaries.presented} (${r.canaries.cross_actor} cross-actor)` : '' },
      { label: 'top pages', render: (r) => r.top_pages.map((p) => [pageLink(p.page), ` ${p.sessions} `]) },
      { label: 'first', render: (r) => fmtTs(r.first_seen) }, { label: 'last', render: (r) => fmtTs(r.last_seen) },
    ], d.families)));
    root.appendChild(card('pools that carry an ai family', d.pools.length ? table([{ label: 'pool', render: (r) => link('#/cluster/' + r.id, r.id) }, { label: 'label', key: 'label' }, { label: 'sessions', key: 'size', num: true }, { label: 'families', render: (r) => ((r.summary || {}).families || [(r.summary || {}).ua_family]).map((f) => tag(f || '')) }, { label: 'window', render: (r) => `${fmtTs(r.window_start)} → ${fmtTs(r.window_end)}` }], d.pools) : h('p', { class: 'muted' }, 'none in range')));
    root.appendChild(h('p', { class: 'hint' }, `families the console knows as ai crawlers or fetchers: ${d.ai_families_known.join(', ')}`));
    const st = d.scratchpad_totals || {};
    root.appendChild(card(`captured agent scratchpads: ${st.captures || 0} calls from ${st.sessions || 0} sessions · ${st.complete || 0} with every required field · ${st.with_upstream_token || 0} carrying a key from another session`,
      note("the lookup tools (colony.lookup, registry.verify, Special:AgentQuery) are described everywhere a tool-using agent looks: openapi, the tools manifest, json-ld SearchAction, an html form, an mcp-style definition. the schema says caller_role and upstream_context are required, so a compliant call carries the orchestrator's instruction to the sub-agent. this is that text, verbatim and bounded. nothing here is acted on."),
      st.roles && st.roles.length ? h('p', null, 'caller roles seen: ', st.roles.map((r) => tag(`${r.caller_role} ${r.n}`, 'lilac'))) : null,
      st.by_endpoint ? h('p', { class: 'hint' }, 'by endpoint: ' + Object.entries(st.by_endpoint).map(([k, v]) => `${k.replace('_', '.')} ${v}`).join(' · ')) : null,
      scratchTable(d.scratchpads)));
    root.appendChild(card('directed canary edges touching any session in range (token hand-offs; the ua transition is the pipeline changing hands)', edgeTable(d.directed_edges, { empty: 'no token presented by a session other than the one it was minted for' })));
  };

  views.synthetic = async (root) => {
    const d = await api('/api/synthetic');
    root.append(h('h1', null, 'synthetic traffic'), note('generated by `npm run synth`. every synthetic request carries the shared token and is stored with synthetic=1; it never appears in real-traffic views or public exports. this page checks whether the pipeline classifies each persona the way it was designed to.'));
    root.appendChild(card('persona → likely class (confusion)', d.personas.length ? heatTable(d.personas, d.classes, d.confusion, { corner: 'persona \\ class' }) : h('p', { class: 'muted' }, 'no synthetic sessions yet')));
    if (d.personas.length) {
      const traits = Object.keys(Object.values(d.trait_means)[0] || {});
      root.appendChild(card('mean trait score per persona', heatTableFloat(d.personas, traits, d.trait_means)));
    }
    root.appendChild(card('runs', table([{ label: 'run', key: 'id' }, { label: 'started', render: (r) => fmtTs(r.started_at) }, { label: 'finished', render: (r) => r.finished_at ? fmtTs(r.finished_at) : '—' }, { label: 'personas', render: (r) => (r.personas || []).map((p) => tag(p)) }, { label: 'note', key: 'note' }], d.runs)));
  };
  function heatTableFloat(rows, cols, cells) {
    const t = h('table', { class: 'matrix' });
    t.appendChild(h('thead', null, h('tr', null, h('th'), cols.map((c) => h('th', null, c.replace(/_/g, ' ').slice(0, 14))))));
    const tb = h('tbody');
    for (const r of rows) tb.appendChild(h('tr', null, h('th', null, r), cols.map((c) => { const v = (cells[r] && cells[r][c]) || 0; return h('td', { class: v > 0.55 ? 'hot' : '', style: `background: rgba(139,111,232,${(v * 0.9).toFixed(2)})` }, v.toFixed(2)); })));
    t.appendChild(tb);
    return h('div', { class: 'tablewrap' }, t);
  }

  views.settings = async (root) => {
    const d = await api('/api/settings');
    root.append(h('h1', null, 'settings & health'));
    const g = h('div', { class: 'grid' }); root.appendChild(g);
    g.appendChild(withSpan(card('build', kv({ version: d.version, env: d.env, 'seed version': d.seed_version, pages: d.pages, attachments: d.attachments, 'public base url': d.public_base_url, 'base path': d.base_path || '(subdomain mode)', 'heuristics': `v${d.heuristics.version} (${d.heuristics.updated})` })), 'span4'));
    g.appendChild(withSpan(card('privacy & limits', kv(Object.assign({}, d.privacy, d.limits, { 'console ip allowlist': d.console_ip_allowlist.join(', ') || '(none — rely on the proxy/vpn)', 'trusted proxies': d.trusted_proxies.join(', ') }))), 'span4'));
    g.appendChild(withSpan(card('storage & pipeline', kv({ 'db bytes': d.db.bytes, sessions: d.db.counts.sessions, events: d.db.counts.events, canaries: d.db.counts.canaries, sightings: d.db.counts.sightings, 'disk guard': d.db.disk ? (d.db.disk.degraded ? 'DEGRADED ' + d.db.disk.reason : 'ok') : 'pending', 'writer pending': d.writer.pending, 'writer dropped': d.writer.dropped, 'writer degraded': d.writer.degraded, 'sessions in memory': d.sessions_in_memory, 'requests since boot': d.stats.requests, 'rate limited since boot': d.stats.limited, 'malformed since boot': d.stats.malformed })), 'span4'));
    const btn = (job, label) => h('button', { class: 'ghost', onclick: async (ev) => { ev.target.disabled = true; const r = await api('/api/jobs/' + job, { method: 'POST', body: '{}' }); out.textContent = JSON.stringify(r); ev.target.disabled = false; } }, label);
    const out = h('pre', null, '');
    g.appendChild(withSpan(card('jobs', h('div', { class: 'filters' }, btn('score', 'score pending sessions'), btn('rescore_all', 'rescore everything'), btn('cluster', 'recluster'), btn('rollup', 'daily rollup'), btn('retention', 'run retention purge'), btn('flush', 'flush writer'), h('button', { class: 'ghost', onclick: async () => { const r = await api('/api/heuristics/reload', { method: 'POST', body: '{}' }); out.textContent = JSON.stringify(r); } }, 'reload heuristics.json'), h('button', { class: 'ghost', onclick: async () => { const r = await api('/api/report', { method: 'POST', body: JSON.stringify({ range: state.range }) }); out.textContent = JSON.stringify(r, null, 2); } }, 'generate observation report')), out), 'span8'));
    g.appendChild(withSpan(card('exports (sanitized)', h('p', null, ['sessions', 'events', 'sightings'].map((k) => [h('a', { href: `/api/export/${k}.jsonl?${qs()}&level=public`, download: '' }, `${k} · public`), ' · ', h('a', { href: `/api/export/${k}.jsonl?${qs()}&level=internal`, download: '' }, 'internal'), h('br')])), h('p', { class: 'hint' }, 'public exports drop network prefixes, user-agent strings, exact timestamps, and external referer hosts, and re-key session/actor ids per export. the sanitizer refuses to emit anything address-shaped.')), 'span4'));
    g.appendChild(withSpan(card('heuristics notes', h('ul', { class: 'caveats' }, d.heuristics.notes.map((n) => h('li', null, n))), h('p', { class: 'hint' }, `traits: ${d.heuristics.traits.join(', ')}`), h('p', { class: 'hint' }, `classes: ${d.heuristics.classes.join(', ')}`)), 'span6'));
    g.appendChild(withSpan(card('experiments', kv({ active: d.experiments.active.join(', ') || 'none', errors: d.experiments.errors.join('; ') || 'none' })), 'span6'));
    g.appendChild(withSpan(card('audit log', table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'user', key: 'user' }, { label: 'action', key: 'action' }, { label: 'detail', render: (r) => h('code', null, (r.detail || '').slice(0, 80)) }], d.audit)), 'span12'));
  };

  // ---------- router ----------
  async function route() {
    const hash = location.hash.replace(/^#\/?/, '') || 'overview';
    const [pathPart, query] = hash.split('?');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    const [name, arg] = pathPart.split('/');
    const view = views[name] || views.overview;
    const root = $('#view');
    root.replaceChildren(h('p', { class: 'muted' }, 'loading…'));
    for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.getAttribute('href') === '#/' + name || (name === 'session' && a.getAttribute('href') === '#/sessions') || (name === 'cluster' && a.getAttribute('href') === '#/clusters') || (name === 'experiment' && a.getAttribute('href') === '#/experiments') || (name === 'page' && a.getAttribute('href') === '#/pages'));
    try {
      const frag = h('div');
      await view(frag, params, arg ? decodeURIComponent(arg) : undefined);
      root.replaceChildren(...frag.childNodes);
    } catch (e) {
      console.error('view failed', e);
      root.replaceChildren(h('p', { class: 'error' }, 'failed to load: ' + (e && e.message ? e.message : String(e))));
    }
  }
  async function boot() {
    try {
      const me = await api('/api/me');
      state.csrf = me.csrf; state.user = me.user;
      $('#logoutcsrf').value = me.csrf;
      const s = await api('/api/settings');
      state.env = s.env;
      const pill = $('#envpill'); pill.textContent = `${s.env} · seed ${s.seed_version}`; pill.classList.toggle('prod', s.env === 'production');
    } catch (e) { return; }
    try { state.range = localStorage.getItem('sg.range') || '24h'; state.synthetic = localStorage.getItem('sg.synthetic') || 'real'; } catch (e) { /* ignore */ }
    $('#range').value = state.range; $('#synthetic').value = state.synthetic;
    $('#range').addEventListener('change', (e) => { state.range = e.target.value; try { localStorage.setItem('sg.range', state.range); } catch (x) { } route(); });
    $('#synthetic').addEventListener('change', (e) => { state.synthetic = e.target.value; try { localStorage.setItem('sg.synthetic', state.synthetic); } catch (x) { } $('#synthwarn').hidden = state.synthetic === 'real'; route(); });
    $('#synthwarn').hidden = state.synthetic === 'real';
    window.addEventListener('hashchange', route);
    route();
  }
  boot();
})();
