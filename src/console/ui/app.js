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
  };
  function stat(v, k) { return h('div', { class: 'card stat' }, h('span', { class: 'v' }, num(v)), h('span', { class: 'k' }, k)); }
  function withSpan(el, cls) { el.classList.add(cls); return el; }

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
            h('span', null, tag(e.ua_family), e.canaries_seen ? tag(`${e.canaries_seen} canary`, 'lilac') : '')));
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
    const f = Object.assign({ class: '', family: '', q: '', sort: 'recent', min_requests: '', offset: 0, cluster: '', experiment: '', arm: '' }, params || {});
    root.append(h('h1', null, 'sessions'));
    const form = h('div', { class: 'filters' },
      h('label', null, 'class ', sel('class', ['', 'human_browser', 'search_bot', 'naive_crawler', 'aggressive_crawler', 'scripted_agent', 'retrieval_agent', 'tool_discovery_agent', 'unknown'], f.class)),
      h('label', null, 'sort ', sel('sort', ['recent', 'requests', 'pages', 'confidence', 'hidden'], f.sort)),
      h('label', null, 'min requests ', h('input', { type: 'text', name: 'min_requests', value: f.min_requests, size: 3 })),
      h('label', null, 'search ', h('input', { type: 'search', name: 'q', value: f.q, placeholder: 'id, ua, path' })),
      f.cluster ? tag('cluster ' + f.cluster, 'lilac') : null, f.experiment ? tag(`${f.experiment}${f.arm ? ':' + f.arm : ''}`, 'lilac') : null,
      h('button', { onclick: () => { const p = {}; for (const el of form.querySelectorAll('select,input')) if (el.value) p[el.name] = el.value; if (f.cluster) p.cluster = f.cluster; if (f.experiment) p.experiment = f.experiment; if (f.arm) p.arm = f.arm; location.hash = '#/sessions?' + new URLSearchParams(p).toString(); } }, 'apply'));
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
      h('p', null, classTag(s.likely_class), ' ', tag(`ua: ${s.ua_family || 'none'}`), ' ', s.synthetic ? tag(`synthetic · ${s.synthetic_persona || ''}`, 'warn') : null, ' ', s.cluster_id ? link('#/cluster/' + s.cluster_id, 'cluster ' + s.cluster_id) : null, ' ', s.cohorts ? Object.entries(s.cohorts).map(([k, v]) => link('#/experiment/' + k, `${k}:${v} `)) : null),
      h('div', { class: 'story' }, st.summary),
      h('ul', { class: 'caveats' }, st.caveats.map((c) => h('li', null, c))));
    const grid = h('div', { class: 'grid' });
    root.appendChild(grid);
    grid.appendChild(withSpan(card('facts', kv({ started: fmtTs(s.started_at), 'last seen': fmtTs(s.last_seen_at), duration: fmtRel(s.last_seen_at - s.started_at), kind: s.kind, 'network prefix': s.ip_trunc || '(not stored)', 'user-agent': s.ua || '(none)', 'cookie returned': s.cookie_returned ? 'yes' : 'no', requests: s.n_requests, 'unique pages': s.n_unique_pages, 'max depth': s.max_depth, 'machine fetches': s.n_machine, 'disallowed fetches': s.n_disallowed, errors: s.n_errors, 'first referer host': s.first_referer_host || '—', actor: s.actor_hash, 'other sessions of actor': d.actor_sessions.length })), 'span4'));
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
    root.append(h('h1', null, 'cohorts'), note('sessions are grouped by page-set overlap, feature similarity, client signature, network prefix, and time overlap. the swarm score sums the coordination signals listed for each group; a high score is a reason to look, not a conclusion.'));
    if (!d.clusters.length) { root.append(h('p', { class: 'muted' }, 'no groups in range — clustering runs every 5 minutes over the last 24h of scored sessions')); return; }
    for (const c of d.clusters) {
      root.appendChild(card(`${c.id} · ${c.label} · swarm score ${c.swarm_score.toFixed(2)} · ${c.size} sessions · ${fmtTs(c.window_start)} → ${fmtTs(c.window_end)}${c.synthetic ? ' · SYNTHETIC' : ''}`,
        h('div', { class: 'two' },
          h('div', null, h('h3', null, 'signals'), c.signals.length ? h('ul', { class: 'evidence' }, c.signals.map((s) => h('li', null, h('span', { class: 'w' }, s.strength.toFixed(2)), ` ${s.signal.replace(/_/g, ' ')}: ${s.note}`))) : h('p', { class: 'muted' }, 'similar sessions, no coordination signal')),
          h('div', null, h('h3', null, 'members'), table([{ label: 'session', render: (r) => sid(r.id) }, { label: 'ua', render: (r) => tag(r.ua_family || '') }, { label: 'class', render: (r) => classTag(r.likely_class) }, { label: 'net', render: (r) => h('code', null, r.ip_trunc || '—') }, { label: 'pages', key: 'n_unique_pages', num: true }, { label: 'started', render: (r) => fmtTs(r.started_at) }], c.members))),
        h('p', null, link('#/cluster/' + c.id, 'open cohort →'), ' · ', link('#/sessions?cluster=' + c.id, 'filter sessions'))));
    }
  };
  views.cluster = async (root, params, id) => {
    const d = await api(`/api/clusters/${encodeURIComponent(id)}`);
    if (d.error) { root.append(h('p', { class: 'error' }, d.error)); return; }
    root.append(h('h1', null, 'cohort ', h('code', null, d.id)), h('p', null, tag(d.label, 'lilac'), ` swarm score ${d.swarm_score.toFixed(2)} · ${d.size} sessions`));
    root.appendChild(card('signals', h('ul', { class: 'evidence' }, d.signals.map((s) => h('li', null, h('span', { class: 'w' }, s.strength.toFixed(2)), ` ${s.signal.replace(/_/g, ' ')}: ${s.note}`)))));
    const members = d.members.map((m) => m.id);
    const pages = Object.keys(d.page_matrix).sort();
    const cells = {}; for (const p of pages) { cells[p] = {}; for (const m of d.page_matrix[p]) cells[p][m.slice(0, 8)] = 1; }
    root.appendChild(card('page coverage matrix (which member fetched which page)', heatTable(pages, members.map((m) => m.slice(0, 8)), cells, { corner: 'page \\ session' })));
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
    root.appendChild(card('download', h('p', null, h('a', { href: `/api/experiments/${e.id}/bundle?${qs()}&level=public`, download: '' }, 'public bundle (sanitized json)'), ' · ', h('a', { href: `/api/experiments/${e.id}/bundle?${qs()}&level=internal`, download: '' }, 'internal bundle (keeps truncated prefixes + ua strings; never publish)')), h('p', { class: 'hint' }, 'bundles carry the definition, the comparison table, sanitized session rows, an event sample, seed + heuristics versions, and a sha256 of the payload.')));
    if (e.fiction_map) root.appendChild(card('fiction map — which public element is which stimulus', kv(e.fiction_map)));
    root.appendChild(card('definition', h('pre', null, JSON.stringify(e, null, 2))));
  };
  function fmtOutcome(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
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
  };

  views.anomalies = async (root) => {
    const d = await api(`/api/anomalies?${qs()}`);
    root.append(h('h1', null, 'anomalies'));
    const g = h('div', { class: 'grid' }); root.appendChild(g);
    g.appendChild(withSpan(card('malformed / unusual requests', table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'session', render: (r) => sid(r.session_id) }, { label: 'method', key: 'method' }, { label: 'path', render: (r) => h('code', null, r.path.slice(0, 70)) }, { label: 'status', key: 'status', num: true }, { label: 'flags', render: (r) => JSON.parse(r.malformed).map((f) => tag(f, 'warn')) }], d.malformed)), 'span12'));
    g.appendChild(withSpan(card('rate limited sessions', table([{ label: 'session', render: (r) => sid(r.session_id) }, { label: '429s', key: 'n', num: true }, { label: 'ua', render: (r) => tag(r.ua_family || '') }], d.rate_limited)), 'span4'));
    g.appendChild(withSpan(card('heavy sessions (≥200 requests)', table([{ label: 'session', render: (r) => sid(r.session_id) }, { label: 'requests', key: 'n', num: true }, { label: 'ua', render: (r) => tag(r.ua_family || '') }], d.heavy_sessions)), 'span4'));
    g.appendChild(withSpan(card('non-GET methods', table([{ label: 'method', key: 'method' }, { label: 'n', key: 'n', num: true }], d.methods)), 'span4'));
    g.appendChild(withSpan(card('write attempts', table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'session', render: (r) => sid(r.session_id) }, { label: 'path', render: (r) => h('code', null, r.path) }, { label: 'status', key: 'status', num: true }, { label: 'body', render: (r) => `${r.body_bytes} B ${r.body_ctype || ''}` }], d.posts)), 'span6'));
    g.appendChild(withSpan(card('most requested missing paths', table([{ label: 'path', render: (r) => h('code', null, r.path) }, { label: 'requests', key: 'n', num: true }, { label: 'sessions', key: 's', num: true }], d.dead_paths)), 'span6'));
    g.appendChild(withSpan(card('probe-like patterns', table([{ label: 'when', render: (r) => fmtTs(r.ts) }, { label: 'session', render: (r) => sid(r.session_id) }, { label: 'path', render: (r) => h('code', null, r.path.slice(0, 80)) }, { label: 'status', key: 'status', num: true }], d.probes)), 'span6'));
    g.appendChild(withSpan(card('search queries typed into the wiki', table([{ label: 'query', render: (r) => h('code', null, r.q || '') }, { label: 'n', key: 'n', num: true }], d.searches)), 'span6'));
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
